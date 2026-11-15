import { WordEntry, PhonologyConfig } from '../types';
import { isDesktopRuntime, saveBinaryFile, saveTextFile } from './fileSave';

/** SheetJS 工作簿句柄（`xlsx` 的类型声明已提供，无需 any） */
type XlsxWorkbook = ReturnType<typeof import('xlsx').utils.book_new>;

/** CSV 字段转义：双引号按 RFC 4180 翻倍 */
function csvField(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Export data as an Excel file with multiple sheets.
 * Uses dynamic import of xlsx (SheetJS) library.
 */
export async function exportExcel(
    languageName: string,
    words: WordEntry[],
    phonoConfig: PhonologyConfig,
): Promise<void> {
    try {
        const XLSX = await import('xlsx');

        const wb: XlsxWorkbook = XLSX.utils.book_new();

        // Sheet 1: Phoneme Inventory
        const phonemeData = [
            ['Type', 'Phonemes'],
            ['Consonants', phonoConfig.phoneme_inventory.consonants.join(', ')],
            ['Vowels', phonoConfig.phoneme_inventory.vowels.join(', ')],
        ];
        const wsPhonemes = XLSX.utils.aoa_to_sheet(phonemeData);
        XLSX.utils.book_append_sheet(wb, wsPhonemes, 'Phonemes');

        // Sheet 2: Romanization
        const defaultMap = phonoConfig.romanization_maps.find((m) => m.is_default) || phonoConfig.romanization_maps[0];
        if (defaultMap) {
            const romanData = [
                ['Input', 'Output (IPA)', 'Context Before', 'Context After'],
                ...defaultMap.rules.map((r) => [r.input, r.output_phoneme, r.context_before, r.context_after]),
            ];
            const wsRoman = XLSX.utils.aoa_to_sheet(romanData);
            XLSX.utils.book_append_sheet(wb, wsRoman, 'Romanization');
        }

        // Sheet 3: Lexicon
        const sorted = [...words].sort((a, b) =>
            a.con_word_romanized.localeCompare(b.con_word_romanized),
        );
        const lexiconData = [
            ['Word', 'IPA', 'POS', 'Gloss', 'Definitions', 'Examples', 'Tags', 'Origin'],
            ...sorted.map((w) => [
                w.con_word_romanized,
                w.phonetic_ipa,
                w.senses.map((s) => s.pos_id).join(', '),
                w.senses.map((s) => s.gloss).join('; '),
                w.senses.flatMap((s) => s.definitions).join('; '),
                w.senses.flatMap((s) => s.examples).join('; '),
                w.metadata.tags.join(', '),
                w.etymology.origin_type,
            ]),
        ];
        const wsLexicon = XLSX.utils.aoa_to_sheet(lexiconData);
        XLSX.utils.book_append_sheet(wb, wsLexicon, 'Lexicon');

        if (isDesktopRuntime()) {
            const base64 = String(
                XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }),
            );
            await saveBinaryFile({
                defaultName: `${languageName}.xlsx`,
                base64,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
            });
            return;
        }
        XLSX.writeFile(wb, `${languageName}.xlsx`);
    } catch (err) {
        // Fallback: CSV export
        console.warn('xlsx not available, falling back to CSV:', err);
        await exportCSVFallback(languageName, words);
    }
}

async function exportCSVFallback(languageName: string, words: WordEntry[]) {
    const sorted = [...words].sort((a, b) =>
        a.con_word_romanized.localeCompare(b.con_word_romanized),
    );
    const header = 'Word,IPA,POS,Gloss\n';
    const rows = sorted.map((w) =>
        [
            csvField(w.con_word_romanized),
            csvField(w.phonetic_ipa),
            csvField(w.senses.map((s) => s.pos_id).join('/')),
            csvField(w.senses.map((s) => s.gloss).join('; ')),
        ].join(','),
    ).join('\n');
    const csv = header + rows;

    await saveTextFile({ defaultName: `${languageName}.csv`, content: csv, mimeType: 'text/csv;charset=utf-8;' });
}
