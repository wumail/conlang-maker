import { WordEntry, PhonologyConfig, GrammarConfig } from '../types';
import { generateParadigm } from './morphologyEngine';

interface PDFSection {
    title: string;
    enabled: boolean;
}

/**
 * Generate PDF content representing the conlang reference document.
 * Uses jspdf + jspdf-autotable when available; falls back to a downloadable HTML file.
 */
export async function exportPDF(
    languageName: string,
    words: WordEntry[],
    phonoConfig: PhonologyConfig,
    grammarConfig: GrammarConfig,
    sections: PDFSection[],
): Promise<void> {
    try {
        // Dynamic import — may fail if packages not installed yet
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jsPDFModule = await import('jspdf' as any);
        const jsPDF = jsPDFModule.default || jsPDFModule.jsPDF;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await import('jspdf-autotable' as any); // side-effect: augments jsPDF

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc: any = new jsPDF();
        let y = 20;

        // Cover page
        doc.setFontSize(28);
        doc.text(languageName, 105, 60, { align: 'center' });
        doc.setFontSize(14);
        doc.text('Language Reference', 105, 75, { align: 'center' });
        doc.setFontSize(10);
        doc.text(new Date().toLocaleDateString(), 105, 90, { align: 'center' });

        // Orthography table
        if (sections.find((s) => s.title === 'orthography')?.enabled) {
            doc.addPage();
            doc.setFontSize(18);
            doc.text('Orthography', 14, 20);
            y = 30;

            const defaultMap = phonoConfig.romanization_maps.find((m) => m.is_default) || phonoConfig.romanization_maps[0];
            if (defaultMap) {
                const tableData = defaultMap.rules.map((r) => [r.input, r.output_phoneme, r.context_before || '', r.context_after || '']);
                doc.autoTable({
                    head: [['Input', 'IPA', 'Before', 'After']],
                    body: tableData,
                    startY: y,
                });
            }
        }

        // Inflection paradigms
        if (sections.find((s) => s.title === 'paradigms')?.enabled) {
            doc.addPage();
            doc.setFontSize(18);
            doc.text('Inflection Paradigms', 14, 20);
            y = 30;

            for (const pos of grammarConfig.parts_of_speech) {
                const dims = grammarConfig.inflection_dimensions.filter((d) =>
                    d.applies_to_pos.includes(pos.pos_id),
                );
                if (dims.length === 0) continue;

                doc.setFontSize(14);
                doc.text(pos.name, 14, y);
                y += 8;

                const paradigm = generateParadigm(
                    'example',
                    pos.pos_id,
                    grammarConfig.inflection_rules,
                    phonoConfig,
                );
                const tableData = paradigm.map((p) => [p.tag, p.result]);
                doc.autoTable({
                    head: [['Form', 'Result']],
                    body: tableData,
                    startY: y,
                });
                y = doc.lastAutoTable?.finalY + 10 || y + 30;
            }
        }

        // Grammar manual
        if (sections.find((s) => s.title === 'manual')?.enabled) {
            doc.addPage();
            doc.setFontSize(18);
            doc.text('Grammar Manual', 14, 20);
            y = 30;

            const sorted = [...grammarConfig.grammar_manual].sort((a, b) => a.order - b.order);
            for (const chapter of sorted) {
                doc.setFontSize(14);
                doc.text(chapter.title, 14, y);
                y += 8;
                doc.setFontSize(10);
                const lines = doc.splitTextToSize(chapter.content, 180);
                doc.text(lines, 14, y);
                y += lines.length * 5 + 10;
                if (y > 270) {
                    doc.addPage();
                    y = 20;
                }
            }
        }

        // Dictionary
        if (sections.find((s) => s.title === 'dictionary')?.enabled) {
            doc.addPage();
            doc.setFontSize(18);
            doc.text('Dictionary', 14, 20);

            const sorted = [...words].sort((a, b) =>
                a.con_word_romanized.localeCompare(b.con_word_romanized),
            );
            const tableData = sorted.map((w) => [
                w.con_word_romanized,
                w.phonetic_ipa ? `/${w.phonetic_ipa}/` : '',
                w.senses.map((s) => `${s.gloss} (${s.pos_id})`).join('; '),
            ]);
            doc.autoTable({
                head: [['Word', 'IPA', 'Meaning']],
                body: tableData,
                startY: 30,
            });
        }

        doc.save(`${languageName}_reference.pdf`);
    } catch (err) {
        // Fallback: generate downloadable HTML
        console.warn('jspdf not available, falling back to HTML export:', err);
        exportHTMLFallback(languageName, words, phonoConfig, grammarConfig);
    }
}

function exportHTMLFallback(
    languageName: string,
    words: WordEntry[],
    _phonoConfig: PhonologyConfig,
    _grammarConfig: GrammarConfig,
) {
    const sorted = [...words].sort((a, b) =>
        a.con_word_romanized.localeCompare(b.con_word_romanized),
    );

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${languageName} Reference</title>
<style>body{font-family:sans-serif;max-width:800px;margin:auto;padding:20px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px;text-align:left}
th{background:#f5f5f5}h1{text-align:center}</style></head>
<body><h1>${languageName}</h1>
<h2>Dictionary</h2><table><tr><th>Word</th><th>IPA</th><th>Meaning</th></tr>
${sorted.map((w) => `<tr><td>${w.con_word_romanized}</td><td>${w.phonetic_ipa || ''}</td><td>${w.senses.map((s) => s.gloss).join(', ')}</td></tr>`).join('\n')}
</table></body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${languageName}_reference.html`;
    a.click();
    URL.revokeObjectURL(url);
}
