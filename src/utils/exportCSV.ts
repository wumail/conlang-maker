import { WordEntry } from '../types';

export const exportToCSV = (words: WordEntry[]): void => {
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
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM 头保证 Excel 中文兼容
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lexicon_export.csv';
  a.click();
  URL.revokeObjectURL(url);
};
