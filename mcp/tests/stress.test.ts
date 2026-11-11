import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpError } from "../errors";
import { readAuditLogs } from "../storage/audit";
import { computeHostKey, withProjectLock } from "../storage/lock";
import {
  readLexiconUnlocked,
  readPhonologyUnlocked,
  readWorkspaceUnlocked,
  withConsistentProjectRead,
} from "../storage/read";
import { computeFileRevision, computeLexiconRevision } from "../storage/revision";
import {
  listSnapshotsUnlocked,
  planLanguageSnapshot,
  planSnapshotRollback,
} from "../storage/snapshot";
import { executeProjectTransaction } from "../storage/transaction";

const FIXTURE_SRC = path.resolve(
  import.meta.dir,
  "../../tests/fixtures/workspace-basic",
);

function cloneWorkspaceFixture(): {
  tempDir: string;
  conlangPath: string;
  cleanup: () => void;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "conlang-stress-"));
  fs.cpSync(FIXTURE_SRC, tempDir, { recursive: true });
  return {
    tempDir,
    conlangPath: path.join(tempDir, "workspace.conlang"),
    cleanup: () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function findResidualTmpFiles(rootDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.includes(".tmp")) {
        found.push(full);
      }
    }
  };
  walk(rootDir);
  return found;
}

describe("T3.10 Lock Contention, CAS, Transaction Crash Recovery & Snapshot Interleaving", () => {
  test("1a. in-process concurrent lock contention strictly serializes critical sections (active <= 1)", async () => {
    const { tempDir, cleanup } = cloneWorkspaceFixture();
    try {
      let active = 0;
      let maxObservedActive = 0;
      const executionOrder: number[] = [];

      await Promise.all(
        Array.from({ length: 12 }, (_, idx) =>
          withProjectLock(tempDir, `worker_${idx}`, async () => {
            active += 1;
            maxObservedActive = Math.max(maxObservedActive, active);
            await new Promise((r) => setTimeout(r, 8));
            executionOrder.push(idx);
            active -= 1;
          }),
        ),
      );

      expect(maxObservedActive).toBe(1);
      expect(executionOrder.length).toBe(12);
      expect(findResidualTmpFiles(tempDir)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("1b. cross-process lock contention & stale dead-PID owner reclamation", async () => {
    const { tempDir, cleanup } = cloneWorkspaceFixture();
    try {
      // Plant a stale owner file from a provably dead local PID (99999999)
      const lockDir = path.join(tempDir, ".conlang-maker", "lock");
      fs.mkdirSync(lockDir, { recursive: true });
      const deadOwner = path.join(
        lockDir,
        `owner-${computeHostKey()}-99999999-${"a".repeat(32)}.json`,
      );
      fs.writeFileSync(
        deadOwner,
        JSON.stringify({
          host_key: computeHostKey(),
          pid: 99999999,
          nonce: "a".repeat(32),
          tool: "crashed_worker",
          acquired_at: new Date().toISOString(),
        }),
      );

      const counterFile = path.join(tempDir, "counter.txt");
      fs.writeFileSync(counterFile, "0", "utf-8");

      const lockModulePath = path.resolve(import.meta.dir, "../storage/lock.ts");
      const workerScript = `
        import fs from "node:fs";
        import { withProjectLock } from ${JSON.stringify(lockModulePath)};
        const dir = process.argv[1];
        const counter = process.argv[2];
        await withProjectLock(dir, "child_proc", async () => {
          const cur = Number(fs.readFileSync(counter, "utf-8"));
          await new Promise((r) => setTimeout(r, 25));
          fs.writeFileSync(counter, String(cur + 1), "utf-8");
        });
      `;

      const runChild = (): Promise<number> =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ["-e", workerScript, tempDir, counterFile],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          let stderr = "";
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf-8");
          });
          child.on("error", reject);
          child.on("close", (code) => {
            if (code !== 0) {
              reject(new Error(`Child exited ${code}: ${stderr}`));
            } else {
              resolve(code ?? 0);
            }
          });
        });

      await Promise.all([runChild(), runChild(), runChild(), runChild()]);

      expect(fs.readFileSync(counterFile, "utf-8")).toBe("4");
      expect(fs.existsSync(deadOwner)).toBe(false);
      expect(findResidualTmpFiles(tempDir)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("2. overlapping CAS read-modify-write rejects stale revision with CONFLICT and preserves r1", async () => {
    const { tempDir, cleanup } = cloneWorkspaceFixture();
    try {
      const grammarPath = path.join(tempDir, "roots", "root", "grammar.json");
      const r0 = computeFileRevision(grammarPath);
      const originalRaw = JSON.parse(fs.readFileSync(grammarPath, "utf-8")) as Record<
        string,
        unknown
      >;

      // Writer 1 commits r0 -> r1
      const res1 = await executeProjectTransaction({
        projectDir: tempDir,
        toolName: "grammar_update_syntax",
        operationId: "op_cas_1",
        requestPayloadForDigest: { order: "SOV" },
        planInsideLock: () => ({
          expectations: [
            {
              label: "grammar",
              targetPath: grammarPath,
              expectedRevision: r0,
            },
          ],
          mutations: [
            {
              kind: "write_file",
              relPath: "roots/root/grammar.json",
              content: JSON.stringify(
                {
                  ...originalRaw,
                  syntax: {
                    ...(originalRaw.syntax as Record<string, unknown>),
                    word_order: "SOV",
                  },
                },
                null,
                2,
              ),
            },
          ],
          buildResponse: (revs) => ({ revision: revs.grammar }),
        }),
      });

      const r1 = res1.revision;
      expect(r1).not.toBe(r0);

      // Writer 2 attempts stale r0 -> must fail with CONFLICT
      let caught: unknown = null;
      try {
        await executeProjectTransaction({
          projectDir: tempDir,
          toolName: "grammar_update_syntax",
          operationId: "op_cas_2",
          requestPayloadForDigest: { order: "VSO" },
          planInsideLock: () => ({
            expectations: [
              {
                label: "grammar",
                targetPath: grammarPath,
                expectedRevision: r0,
              },
            ],
            mutations: [
              {
                kind: "write_file",
                relPath: "roots/root/grammar.json",
                content: JSON.stringify(
                  {
                    ...originalRaw,
                    syntax: {
                      ...(originalRaw.syntax as Record<string, unknown>),
                      word_order: "VSO",
                    },
                  },
                  null,
                  2,
                ),
              },
            ],
            buildResponse: (revs) => ({ revision: revs.grammar }),
          }),
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(McpError);
      expect((caught as McpError).code).toBe("CONFLICT");
      expect(computeFileRevision(grammarPath)).toBe(r1);
      const saved = JSON.parse(fs.readFileSync(grammarPath, "utf-8")) as {
        syntax: { word_order: string };
      };
      expect(saved.syntax.word_order).toBe("SOV");
    } finally {
      cleanup();
    }
  });

  test("3 & 4. multi-file transaction fault injection (after_manifest, mid_apply, before_committed, before_audit) + read-only RECOVERY_REQUIRED", async () => {
    const stages: Array<"after_manifest" | "mid_apply" | "before_committed"> = [
      "after_manifest",
      "mid_apply",
      "before_committed",
    ];

    for (const stage of stages) {
      const { tempDir, cleanup } = cloneWorkspaceFixture();
      try {
        const fileA = path.join(tempDir, "roots", "root", "grammar.json");
        const fileB = path.join(tempDir, "roots", "root", "sca_rules.json");
        const bytesABefore = fs.readFileSync(fileA, "utf-8");
        const bytesBBefore = fs.readFileSync(fileB, "utf-8");
        const revABefore = computeFileRevision(fileA);
        const revBBefore = computeFileRevision(fileB);

        await expect(
          executeProjectTransaction({
            projectDir: tempDir,
            toolName: "fault_uncommitted_test",
            operationId: `op_fault_${stage}`,
            requestPayloadForDigest: { stage },
            faultHook: {
              stage,
              trigger: () => {
                throw new Error(`Simulated crash at ${stage}`);
              },
            },
            planInsideLock: () => ({
              expectations: [
                { label: "a", targetPath: fileA, expectedRevision: revABefore },
                { label: "b", targetPath: fileB, expectedRevision: revBBefore },
              ],
              mutations: [
                {
                  kind: "write_file",
                  relPath: "roots/root/grammar.json",
                  content: JSON.stringify({ crashed: stage, file: "A" }),
                },
                {
                  kind: "write_file",
                  relPath: "roots/root/sca_rules.json",
                  content: JSON.stringify({ crashed: stage, file: "B" }),
                },
              ],
              buildResponse: (revs) => revs,
            }),
          }),
        ).rejects.toThrow(`Simulated crash at ${stage}`);

        // Pending tx directory exists because committed marker was never written
        const txRoot = path.join(tempDir, ".conlang-maker", "transactions");
        expect(fs.readdirSync(txRoot).length).toBe(1);

        // Read-only mode MUST fail with RECOVERY_REQUIRED without mutating files!
        let roErr: unknown = null;
        try {
          await withConsistentProjectRead(tempDir, "read-only", "ro_probe", () => true);
        } catch (err) {
          roErr = err;
        }
        expect(roErr).toBeInstanceOf(McpError);
        expect((roErr as McpError).code).toBe("RECOVERY_REQUIRED");
        expect(fs.readdirSync(txRoot).length).toBe(1);

        // Write mode automatically rolls back preimages in reverse order & cleans tx dir
        await withConsistentProjectRead(tempDir, "write", "rw_recover", () => true);
        expect(fs.readdirSync(txRoot).length).toBe(0);
        expect(fs.readFileSync(fileA, "utf-8")).toBe(bytesABefore);
        expect(fs.readFileSync(fileB, "utf-8")).toBe(bytesBBefore);
        expect(computeFileRevision(fileA)).toBe(revABefore);
        expect(computeFileRevision(fileB)).toBe(revBBefore);
      } finally {
        cleanup();
      }
    }

    // Now test crash AFTER `committed` marker (`before_audit`): recovery must COMPLETE projection, NOT roll back!
    const { tempDir, cleanup } = cloneWorkspaceFixture();
    try {
      const fileA = path.join(tempDir, "roots", "root", "sca_rules.json");
      const revABefore = computeFileRevision(fileA);
      const updatedBody = JSON.stringify(
        { language_id: "lang_root", rule_sets: [], x_after_commit: true },
        null,
        2,
      );

      await expect(
        executeProjectTransaction({
          projectDir: tempDir,
          toolName: "fault_committed_test",
          operationId: "op_fault_before_audit",
          requestPayloadForDigest: { committed: true },
          faultHook: {
            stage: "before_audit",
            trigger: () => {
              throw new Error("Simulated crash at before_audit");
            },
          },
          planInsideLock: () => ({
            expectations: [
              { label: "sca", targetPath: fileA, expectedRevision: revABefore },
            ],
            mutations: [
              {
                kind: "write_file",
                relPath: "roots/root/sca_rules.json",
                content: updatedBody,
              },
            ],
            buildResponse: (revs) => ({ ok: true, revision: revs.sca }),
          }),
        }),
      ).rejects.toThrow("Simulated crash at before_audit");

      // Recover on next write-mode read -> completes audit & completed_ops!
      await withConsistentProjectRead(tempDir, "write", "rw_complete", () => true);
      expect(fs.readFileSync(fileA, "utf-8")).toBe(updatedBody);

      const audits = readAuditLogs(tempDir);
      expect(
        audits.some((a) => a.operation_id === "op_fault_before_audit"),
      ).toBe(true);

      // Re-submitting exact same operation_id + payload returns cached result idempotently!
      let planRuns = 0;
      const replay = await executeProjectTransaction({
        projectDir: tempDir,
        toolName: "fault_committed_test",
        operationId: "op_fault_before_audit",
        requestPayloadForDigest: { committed: true },
        planInsideLock: () => {
          planRuns += 1;
          throw new Error("Should not re-plan already completed operation");
        },
      });
      expect(planRuns).toBe(0);
      expect(replay).toEqual({
        ok: true,
        revision: computeFileRevision(fileA),
      });

      // Re-using same operation_id with a DIFFERENT payload must fail with VALIDATION!
      let reuseErr: unknown = null;
      try {
        await executeProjectTransaction({
          projectDir: tempDir,
          toolName: "fault_committed_test",
          operationId: "op_fault_before_audit",
          requestPayloadForDigest: { committed: false },
          planInsideLock: () => ({
            expectations: [],
            mutations: [],
            buildResponse: () => ({ ok: false, revision: "" }),
          }),
        });
      } catch (err) {
        reuseErr = err;
      }
      expect(reuseErr).toBeInstanceOf(McpError);
      expect((reuseErr as McpError).code).toBe("VALIDATION");
      expect(findResidualTmpFiles(tempDir)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("5. interleaved multi-scope snapshots: rolling back lexicon S1 preserves phonology S2 & creates recovery point", async () => {
    const { tempDir, conlangPath, cleanup } = cloneWorkspaceFixture();
    try {
      const ws = readWorkspaceUnlocked(conlangPath).config;
      const rootLang = ws.languages.find((l) => l.language_id === "lang_root")!;
      const rootDir = path.join(tempDir, rootLang.path);
      const lexDir = path.join(rootDir, "lexicon");
      const phonoPath = path.join(rootDir, "phonology.json");

      const lexBeforeS1 = readLexiconUnlocked(tempDir, rootLang).words.map(
        (w) => w.con_word_romanized,
      );

      // Step 1: Create lexicon snapshot S1 + mutate lexicon
      const s1Res = await executeProjectTransaction({
        projectDir: tempDir,
        toolName: "test_snap_s1",
        operationId: "op_interleave_s1",
        requestPayloadForDigest: { step: 1 },
        planInsideLock: () => {
          const snap = planLanguageSnapshot({
            projectDir: tempDir,
            language: rootLang,
            scope: "lexicon",
            description: "S1 lexicon baseline",
          });
          return {
            expectations: [
              {
                label: "lexicon",
                targetPath: lexDir,
                isLexiconDir: true,
                expectedRevision: computeLexiconRevision(lexDir),
              },
            ],
            mutations: [
              ...snap.mutations,
              {
                kind: "write_file",
                relPath: `${rootLang.path}/lexicon/z.ndjson`,
                content:
                  JSON.stringify({
                    entry_id: "w_extra_after_s1",
                    language_id: "lang_root",
                    con_word_romanized: "zoru",
                    phonetic_ipa: "zoru",
                    senses: [
                      {
                        sense_id: "s_z1",
                        pos_id: "pos_noun",
                        gloss: "star",
                        definitions: [],
                        examples: [],
                      },
                    ],
                    etymology: {
                      origin_type: "a_priori",
                      parent_entry_id: null,
                      source_language_id: null,
                      applied_sound_changes: [],
                      semantic_shift_note: "",
                    },
                    metadata: { tags: [], created_at: "", updated_at: "" },
                  }) + "\n",
              },
            ],
            snapshotId: snap.snapshotId,
            buildResponse: () => ({ s1: snap.snapshotId }),
          };
        },
      });

      // Step 2: Create phonology snapshot S2 + mutate phonology (add phoneme "q")
      const phonoBeforeS2 = JSON.parse(fs.readFileSync(phonoPath, "utf-8")) as {
        phoneme_inventory: { consonants: string[]; vowels: string[] };
      };
      await executeProjectTransaction({
        projectDir: tempDir,
        toolName: "test_snap_s2",
        operationId: "op_interleave_s2",
        requestPayloadForDigest: { step: 2 },
        planInsideLock: () => {
          const snap = planLanguageSnapshot({
            projectDir: tempDir,
            language: rootLang,
            scope: "phonology",
            description: "S2 phonology baseline",
          });
          const nextPhono = {
            ...phonoBeforeS2,
            phoneme_inventory: {
              ...phonoBeforeS2.phoneme_inventory,
              consonants: [...phonoBeforeS2.phoneme_inventory.consonants, "q"],
            },
          };
          return {
            expectations: [
              {
                label: "phonology",
                targetPath: phonoPath,
                expectedRevision: computeFileRevision(phonoPath),
              },
            ],
            mutations: [
              ...snap.mutations,
              {
                kind: "write_file",
                relPath: `${rootLang.path}/phonology.json`,
                content: JSON.stringify(nextPhono, null, 2),
              },
            ],
            snapshotId: snap.snapshotId,
            buildResponse: () => ({ s2: snap.snapshotId }),
          };
        },
      });

      // Step 3: Create lexicon snapshot S3
      await executeProjectTransaction({
        projectDir: tempDir,
        toolName: "test_snap_s3",
        operationId: "op_interleave_s3",
        requestPayloadForDigest: { step: 3 },
        planInsideLock: () => {
          const snap = planLanguageSnapshot({
            projectDir: tempDir,
            language: rootLang,
            scope: "lexicon",
            description: "S3 lexicon post-zoru",
          });
          return {
            expectations: [],
            mutations: snap.mutations,
            snapshotId: snap.snapshotId,
            buildResponse: () => ({ s3: snap.snapshotId }),
          };
        },
      });

      // Step 4: Rollback lexicon S1 -> must remove "zoru", preserve phonology "q", and record rollback_recovery!
      const rbRes = await executeProjectTransaction({
        projectDir: tempDir,
        toolName: "snapshot_rollback",
        operationId: "op_interleave_rb_s1",
        requestPayloadForDigest: { snapshot_id: s1Res.s1 },
        planInsideLock: ({ operationId }) => {
          const rb = planSnapshotRollback({
            projectDir: tempDir,
            conlangFilePath: conlangPath,
            workspace: ws,
            snapshotId: s1Res.s1,
            languageId: "lang_root",
            operationId,
          });
          return {
            expectations: [
              {
                label: "lexicon",
                targetPath: lexDir,
                isLexiconDir: true,
                expectedRevision: computeLexiconRevision(lexDir),
              },
            ],
            mutations: rb.mutations,
            snapshotId: rb.recoverySnapshotId,
            buildResponse: () => ({ recoveryId: rb.recoverySnapshotId }),
          };
        },
      });

      const lexAfterRollback = readLexiconUnlocked(tempDir, rootLang).words.map(
        (w) => w.con_word_romanized,
      );
      expect(lexAfterRollback).toEqual(lexBeforeS1);
      expect(lexAfterRollback).not.toContain("zoru");

      const phonoAfterRollback = readPhonologyUnlocked(
        tempDir,
        conlangPath,
        rootLang,
      );
      expect(
        phonoAfterRollback.local_config?.phoneme_inventory.consonants,
      ).toContain("q");

      const allSnaps = listSnapshotsUnlocked(tempDir, ws, "lang_root");
      expect(
        allSnaps.some(
          (s) =>
            s.snapshot_id === rbRes.recoveryId &&
            s.operation_type === "rollback_recovery" &&
            s.restored_from === s1Res.s1,
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });
});
