import { WordEntry, OriginType } from '../types';

type CSVFormat = 'polyglot' | 'vulgarlang' | 'generic';

interface CSVColumnMapping {
    word: number;
    ipa: number;
    pos: number;
    gloss: number;
    definition: number;
}

interface ImportPreview {
    format: CSVFormat;
    headers: string[];
    mapping: CSVColumnMapping;
    rows: string[][];
    words: WordEntry[];
}

/**
 * Parse CSV text into rows.
 */
function parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
        if (!line.trim()) continue;
        const row: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        row.push(current.trim());
        rows.push(row);
    }

    return rows;
}

/**
 * Auto-detect CSV format by analyzing headers.
 */
function detectFormat(headers: string[]): { format: CSVFormat; mapping: CSVColumnMapping } {
    const lower = headers.map((h) => h.toLowerCase().trim());

    // PolyGlot format: "Word", "Local Word", "Type", "Pronunciation", "Definition"
    if (lower.includes('local word') || lower.includes('pronunciation')) {
        return {
            format: 'polyglot',
            mapping: {
                word: lower.indexOf('word'),
                ipa: lower.indexOf('pronunciation'),
                pos: lower.indexOf('type'),
                gloss: lower.indexOf('local word'),
                definition: lower.indexOf('definition'),
            },
        };
    }

    // Vulgarlang format: "word", "ipa", "pos", "meaning"
    if (lower.includes('ipa') || lower.includes('meaning')) {
        return {
            format: 'vulgarlang',
            mapping: {
                word: lower.indexOf('word'),
                ipa: lower.indexOf('ipa'),
                pos: lower.indexOf('pos'),
                gloss: lower.findIndex((h) => h === 'meaning' || h === 'gloss'),
                definition: lower.indexOf('definition'),
            },
        };
    }

    // Generic: try to find common column names
    return {
        format: 'generic',
        mapping: {
            word: Math.max(0, lower.findIndex((h) => h.includes('word'))),
            ipa: lower.findIndex((h) => h.includes('ipa') || h.includes('phonetic') || h.includes('pronunciation')),
            pos: lower.findIndex((h) => h.includes('pos') || h.includes('type') || h.includes('part')),
            gloss: lower.findIndex((h) => h.includes('gloss') || h.includes('meaning') || h.includes('translation')),
            definition: lower.findIndex((h) => h.includes('definition') || h.includes('def')),
        },
    };
}

/**
 * Convert a CSV row to a WordEntry using the column mapping.
 */
function rowToWordEntry(
    row: string[],
    mapping: CSVColumnMapping,
    languageId: string,
): WordEntry {
    const word = mapping.word >= 0 ? row[mapping.word] || '' : '';
    const ipa = mapping.ipa >= 0 ? row[mapping.ipa] || '' : '';
    const pos = mapping.pos >= 0 ? row[mapping.pos] || '' : '';
    const gloss = mapping.gloss >= 0 ? row[mapping.gloss] || '' : '';
    const definition = mapping.definition >= 0 ? row[mapping.definition] || '' : '';

    return {
        entry_id: `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        language_id: languageId,
        con_word_romanized: word,
        phonetic_ipa: ipa,
        phonetic_override: ipa.length > 0,
        senses: [
            {
                sense_id: `sense_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 4)}`,
                pos_id: normalizePOS(pos),
                gloss,
                definitions: definition ? [definition] : [],
                examples: [],
            },
        ],
        etymology: {
            origin_type: 'a_posteriori' as OriginType,
            parent_entry_id: null,
            source_language_id: null,
            applied_sound_changes: [],
            semantic_shift_note: '',
        },
        metadata: {
            tags: ['imported'],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
    };
}

/**
 * Normalize POS strings to pos_id format.
 */
function normalizePOS(pos: string): string {
    const lower = pos.toLowerCase().trim();
    const map: Record<string, string> = {
        noun: 'pos_noun',
        n: 'pos_noun',
        verb: 'pos_verb',
        v: 'pos_verb',
        adjective: 'pos_adj',
        adj: 'pos_adj',
        adverb: 'pos_adv',
        adv: 'pos_adv',
        pronoun: 'pos_pron',
        pron: 'pos_pron',
        preposition: 'pos_prep',
        prep: 'pos_prep',
        conjunction: 'pos_conj',
        conj: 'pos_conj',
        interjection: 'pos_interj',
        interj: 'pos_interj',
    };
    return map[lower] || lower || 'pos_noun';
}

/**
 * Preview a CSV import: parse, detect format, and generate WordEntry previews.
 */
export function previewCSVImport(
    csvText: string,
    languageId: string,
): ImportPreview {
    const allRows = parseCSV(csvText);
    if (allRows.length === 0) {
        return { format: 'generic', headers: [], mapping: { word: 0, ipa: -1, pos: -1, gloss: -1, definition: -1 }, rows: [], words: [] };
    }

    const headers = allRows[0];
    const dataRows = allRows.slice(1);
    const { format, mapping } = detectFormat(headers);

    const words = dataRows
        .filter((row) => row.some((cell) => cell.trim().length > 0))
        .map((row) => rowToWordEntry(row, mapping, languageId));

    return { format, headers, mapping, rows: dataRows, words };
}
