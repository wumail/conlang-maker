export interface CorePurityCheckOptions {
  projectRoot?: string;
}

export interface CorePurityCheckResult {
  ok: boolean;
  checkedFiles: string[];
  violations: string[];
}

export function checkCorePurity(
  options?: CorePurityCheckOptions,
): CorePurityCheckResult;
