import { WordEntry } from '../types';
import { saveTextFile } from './fileSave';

export const exportToCSV = async (words: WordEntry[]): Promise<void> => {
  const headers = ['entry_id', 'con_word_romanized', 'phonetic_ipa', 'pos_id', 'gloss', 'definitions', 'examples'];
  const rows = words.flatMap(w =>
    w.senses.map(s => [
      w.entry_id,
      w.con_word_romanized,
      w.phonetic_ipa,
      s.pos_id,
      s.gloss,
      s.definitions.join(' | '),
      s.examples.join(' | '),
    ])
  );
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  // BOM 头保证 Excel 中文兼容
  await saveTextFile({
    defaultName: 'lexicon_export.csv',
    content: '\ufeff' + csv,
    mimeType: 'text/csv;charset=utf-8;',
  });
};
