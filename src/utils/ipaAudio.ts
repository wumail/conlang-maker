/**
 * IPA phoneme → audio filename mapping.
 * Audio files live in public/ipa_audio/.
 * All playable files are .mp3 conversions of the originals.
 */

const BASE = '/ipa_audio/';

/** Map from IPA symbol string to audio filename (relative to BASE). */
export const IPA_AUDIO_MAP: Record<string, string> = {
  // ── Nasals ────────────────────────────────────────────────────────────────
  'm': 'Bilabial_nasal.ogg.mp3',
  'm̥': 'Voiceless_Bilabial_Nasal.ogg.mp3',
  'ɱ': 'Labiodental_nasal.ogg.mp3',
  'ɱ̊': 'Voiceless_labiodental_nasal.ogg.mp3',
  'n̼': 'Linguolabial_nasal.ogg.mp3',
  'n̥': 'Voiceless_Alveolar_Nasal.ogg.mp3',
  'n': 'Alveolar_nasal.ogg.mp3',
  'n̪': 'Voiced_Dental_Nasal.ogg.mp3',
  'n̠': 'Voiced_postalveolar_nasal.ogg.mp3',
  'ɳ': 'Retroflex_nasal.ogg.mp3',
  'ɳ̊': 'Voiceless_retroflex_nasal.wav.mp3',
  'ɲ': 'Palatal_nasal.ogg.mp3',
  'ɲ̊': 'Voiceless_palatal_nasal.ogg.mp3',
  'ŋ': 'Velar_nasal.ogg.mp3',
  'ŋ̊': 'Voiceless_velar_nasal.wav.mp3',
  'ɴ': 'Uvular_nasal.ogg.mp3',
  'ɴ̥': 'Voiceless_uvular_nasal.ogg.mp3',

  // ── Plosives ──────────────────────────────────────────────────────────────
  'p': 'Voiceless_bilabial_plosive.ogg.mp3',
  'b': 'Voiced_bilabial_plosive.ogg.mp3',
  'p̪': 'Voiceless_labiodental_plosive.ogg.mp3',
  'b̪': 'Voiced_labiodental_plosive.wav.mp3',
  't̼': 'Voiceless_linguolabial_stop.ogg.mp3',
  'd̼': 'Voiced_linguolabial_stop.ogg.mp3',
  't̪': 'Voiceless_dental_stop.ogg.mp3',
  'd̪': 'Voiced_dental_stop.ogg.mp3',
  't': 'Voiceless_alveolar_plosive.ogg.mp3',
  'd': 'Voiced_alveolar_plosive.ogg.mp3',
  'ʈ': 'Voiceless_retroflex_stop.oga.mp3',
  'ɖ': 'Voiced_retroflex_stop.oga.mp3',
  'c': 'Voiceless_palatal_plosive.ogg.mp3',
  'ɟ': 'Voiced_palatal_plosive.ogg.mp3',
  'k': 'Voiceless_velar_plosive.ogg.mp3',
  'ɡ': 'Voiced_velar_plosive_02.ogg.mp3',
  'q': 'Voiceless_uvular_plosive.ogg.mp3',
  'ɢ': 'Voiced_uvular_stop.oga.mp3',
  'ʡ': 'Epiglottal_stop.ogg.mp3',
  'ʔ': 'Glottal_stop.ogg.mp3',

  // ── Sibilant affricates ───────────────────────────────────────────────────
  't̪s̪': 'Voiceless_dental_sibilant_affricate.oga.mp3',
  'd̪z̪': 'Voiced_dental_sibilant_affricate.oga.mp3',
  'ts': 'Voiceless_alveolar_sibilant_affricate.oga.mp3',
  'dz': 'Voiced_alveolar_sibilant_affricate.oga.mp3',
  't̠ʃ': 'Voiceless_palato-alveolar_affricate.ogg.mp3',
  'd̠ʒ': 'Voiced_palato-alveolar_affricate.ogg.mp3',
  'tʂ': 'Voiceless_retroflex_affricate.ogg.mp3',
  'dʐ': 'Voiced_retroflex_affricate.ogg.mp3',
  'tɕ': 'Voiceless_alveolo-palatal_affricate.ogg.mp3',
  'dʑ': 'Voiced_alveolo-palatal_affricate.ogg.mp3',

  // ── Non-sibilant affricates ───────────────────────────────────────────────
  'pɸ': 'Voiceless_bilabial_affricate.ogg.mp3',
  'bβ': 'Voiced_bilabial_affricate.wav.mp3',
  'p̪f': 'Voiceless_labiodental_affricate.ogg.mp3',
  'b̪v': 'Voiced_labiodental_affricate.ogg.mp3',
  't̪θ': 'Voiceless_dental_non-sibilant_affricate.oga.mp3',
  'd̪ð': 'Voiced_dental_non-sibilant_affricate.oga.mp3',
  'tɹ̝̊': 'Voiceless_postalveolar_non-sibilant_affricate.ogg.mp3',
  'dɹ̝': 'Voiced_postalveolar_non-sibilant_affricate.ogg.mp3',
  'cç': 'Voiceless_palatal_affricate.ogg.mp3',
  'ɟʝ': 'Voiced_palatal_affricate.ogg.mp3',
  'kx': 'Voiceless_velar_affricate.ogg.mp3',
  'ɡɣ': 'Voiced_velar_affricate.ogg.mp3',
  'qχ': 'Voiceless_uvular_affricate.ogg.mp3',
  'ɢʁ': 'Voiced_uvular_affricate.ogg.mp3',
  'ʡʜ': 'Voiceless_epiglottal_affricate.ogg.mp3',
  'ʡʢ': 'Voiced_epiglottal_affricate.ogg.mp3',
  'ʔh': 'Voiceless_glottal_affricate.ogg.mp3',

  // ── Sibilant fricatives ───────────────────────────────────────────────────
  's̪': 'Voiceless_dental_sibilant_fricative.ogg.mp3',
  's': 'Voiceless_alveolar_sibilant.ogg.mp3',
  'z': 'Voiced_alveolar_sibilant.ogg.mp3',
  'ʃ': 'Voiceless_palato-alveolar_sibilant.ogg.mp3',
  'ʒ': 'Voiced_palato-alveolar_sibilant.ogg.mp3',
  'ʂ': 'Voiceless_retroflex_sibilant.ogg.mp3',
  'ʐ': 'Voiced_retroflex_sibilant.ogg.mp3',
  'ɕ': 'Voiceless_alveolo-palatal_sibilant.ogg.mp3',
  'ʑ': 'Voiced_alveolo-palatal_sibilant.ogg.mp3',

  // ── Non-sibilant fricatives ───────────────────────────────────────────────
  'ɸ': 'Voiceless_bilabial_fricative.ogg.mp3',
  'β': 'Voiced_bilabial_fricative.ogg.mp3',
  'f': 'Voiceless_labio-dental_fricative.ogg.mp3',
  'v': 'Voiced_labio-dental_fricative.ogg.mp3',
  'θ̼': 'Voiceless_linguolabial_fricative.ogg.mp3',
  'ð̼': 'Voiced_linguolabial_fricative.wav.mp3',
  'θ': 'Voiceless_dental_fricative.ogg.mp3',
  'ð': 'Voiced_dental_fricative.ogg.mp3',
  'θ̠': 'Voiceless_postalveolar_non-sibilant_fricative.ogg.mp3',
  'ð̠': 'Voiced_postalveolar_non-sibilant_fricative.ogg.mp3',
  'ɹ̠̊˔': 'Voiceless_postalveolar_non-sibilant_fricative.ogg.mp3',
  'ɹ̠˔': 'Voiced_postalveolar_non-sibilant_fricative.ogg.mp3',
  'ɻ̊˔': 'Voiceless_retroflex_non-sibilant_fricative.ogg.mp3',
  'ɻ˔': 'Voiced_retroflex_non-sibilant_fricative.ogg.mp3',
  'ç': 'Voiceless_palatal_fricative.ogg.mp3',
  'ʝ': 'Voiced_palatal_fricative.ogg.mp3',
  'x': 'Voiceless_velar_fricative.ogg.mp3',
  'ɣ': 'Voiced_velar_fricative.ogg.mp3',
  'χ': 'Voiceless_uvular_fricative.ogg.mp3',
  'ʁ': 'Voiced_uvular_fricative.ogg.mp3',
  'ħ': 'Voiceless_pharyngeal_fricative.ogg.mp3',
  'ʕ': 'Voiced_pharyngeal_fricative.ogg.mp3',
  'h': 'Voiceless_glottal_fricative.ogg.mp3',
  'ɦ': 'Voiced_glottal_fricative.ogg.mp3',

  // ── Approximants ──────────────────────────────────────────────────────────
  'β̞': 'Bilabial_approximant.ogg.mp3',
  'ʋ': 'Labiodental_approximant.ogg.mp3',
  'ð̞': 'Voiced_dental_fricative.ogg.mp3',
  'ɹ': 'Alveolar_approximant.ogg.mp3',
  'ɹ̠': 'Postalveolar_approximant.ogg.mp3',
  'ɻ': 'Retroflex_Approximant2.oga.mp3',
  'j': 'Palatal_approximant.ogg.mp3',
  'ɰ': 'Voiced_velar_approximant.ogg.mp3',
  '˷': 'Creaky-voiced_glottal_approximant.wav.mp3',
  'ʔ̞': 'Creaky-voiced_glottal_approximant.wav.mp3',

  // ── Taps / Flaps ──────────────────────────────────────────────────────────
  'ⱱ̟': 'Voiced_bilabial_flap.wav.mp3',
  'ⱱ': 'Labiodental_flap.ogg.mp3',
  'ɾ̥': 'Voiceless_alveolar_tap.wav.mp3',
  'ɾ̪': 'Alveolar_tap.ogg.mp3',
  'ɾ': 'Alveolar_tap.ogg.mp3',
  'ɾ̠': 'Alveolar_tap.ogg.mp3',
  'ɽ': 'Retroflex_flap.ogg.mp3',
  'ɽ̊': 'Retroflex_flap.ogg.mp3',
  'ɢ̆': 'Voiced_uvular_tap.wav.mp3',
  'ʡ̮': 'Epiglottal_flap.oga.mp3',
  'ʡ̆': 'Epiglottal_flap.oga.mp3',

  // ── Trills ────────────────────────────────────────────────────────────────
  'ʙ̥': 'Voiceless_bilabial_trill_with_aspiration.ogg.mp3',
  'ʙ': 'Bilabial_trill.ogg.mp3',
  'r̥': 'Voiceless_alveolar_trill.ogg.mp3',
  'r': 'Alveolar_trill.ogg.mp3',
  'r̠': 'Voiced_postalveolar_trill.ogg.mp3',
  'ɽ̊r̥': 'Voiceless_retroflex_trill.ogg.mp3',
  'ɽr': 'Voiced_retroflex_trill.ogg.mp3',
  'ʀ̥': 'Voiceless_uvular_trill.ogg.mp3',
  'ʀ': 'Uvular_trill.ogg.mp3',
  'ʜ': 'Voiceless_epiglottal_trill.ogg.mp3',
  'ʢ': 'Voiced_epiglottal_trill_2.ogg.mp3',

  // ── Lateral affricates ────────────────────────────────────────────────────
  'tɬ': 'Voiceless_alveolar_lateral_affricate.ogg.mp3',
  'dɮ': 'Voiced_alveolar_lateral_affricate.ogg.mp3',
  'tꞎ': 'Voiceless_retroflex_lateral_affricate.ogg.mp3',
  'd𝼅': 'Voiced_retroflex_lateral_affricate.ogg.mp3',
  'c𝼆': 'Voiceless_palatal_lateral_affricate.ogg.mp3',
  'ɟʎ̝': 'Voiced_palatal_lateral_affricate.ogg.mp3',
  'k𝼄': 'Voiceless_velar_lateral_affricate.ogg.mp3',
  'ɡʟ̝': 'Voiced_velar_lateral_affricate.ogg.mp3',

  // ── Lateral fricatives ────────────────────────────────────────────────────
  'ɬ': 'Voiceless_alveolar_lateral_fricative.ogg.mp3',
  'ɮ': 'Voiced_alveolar_lateral_fricative.ogg.mp3',
  'ꞎ': 'Voiceless_retroflex_lateral_fricative.ogg.mp3',
  '𝼅': 'Voiced_retroflex_lateral_fricative.wav.mp3',
  '𝼆': 'Voiceless_palatal_lateral_fricative.ogg.mp3',
  'ʎ̝': 'ʎ̝_IPA_sound.opus.mp3',
  '𝼄': 'Voiceless_velar_lateral_fricative.ogg.mp3',
  'ʟ̝': 'Voiced_velar_lateral_fricative.ogg.mp3',

  // ── Lateral approximants ──────────────────────────────────────────────────
  'l̪': 'Voiced_dental_lateral_approximant.ogg.mp3',
  'l̥': 'Voiceless_alveolar_lateral_approximant.ogg.mp3',
  'l': 'Alveolar_lateral_approximant.ogg.mp3',
  'l̠': 'Voiced_postalveolar_lateral_approximant.ogg.mp3',
  'ɭ': 'Retroflex_lateral_approximant.ogg.mp3',
  'ʎ': 'Palatal_lateral_approximant.ogg.mp3',
  'ʟ': 'Velar_lateral_approximant.ogg.mp3',
  'ʟ̠': 'Uvular_lateral_approximant.ogg.mp3',
  'ɫ': 'Velarized_alveolar_lateral_approximant.ogg.mp3',

  // ── Lateral taps/flaps ────────────────────────────────────────────────────
  'ɺ̥': 'Voiceless_alveolar_lateral_flap.wav.mp3',
  'ɺ': 'Voiced_alveolar_lateral_flap.wav.mp3',
  '𝼈̊': 'Voiceless_retroflex_lateral_flap.wav.mp3',
  '𝼈': 'Voiced_retroflex_lateral_flap_(correct).wav.mp3',
  'ɭ̆': 'Voiced_retroflex_lateral_flap_(correct).wav.mp3',
  'ʎ̮': 'Voiced_palatal_lateral_flap.wav.mp3',
  'ʎ̆': 'Voiced_palatal_lateral_flap.wav.mp3',
  'ʟ̆': 'Voiced_velar_lateral_tap.wav.mp3',

  // ── Non-pulmonic: Implosives ──────────────────────────────────────────────
  'ɓ': 'Voiced_bilabial_implosive.ogg.mp3',
  'ɗ': 'Voiced_alveolar_implosive.ogg.mp3',
  'ᶑ': 'Voiced-retroflex-implosive.ogg.mp3',
  'ʄ': 'Voiced_palatal_implosive.ogg.mp3',
  'ɠ': 'Voiced_velar_implosive.ogg.mp3',
  'ʛ': 'Voiced_uvular_implosive.ogg.mp3',
  'ɓ̥': 'Voiceless-bilabial-implosive.ogg.mp3',
  'ɗ̥': 'Voiceless-alveolar-implosive.ogg.mp3',
  'ᶑ̥': 'Voiceless-retroflex-implosive.ogg.mp3',
  'ᶑ̊': 'Voiceless-retroflex-implosive.ogg.mp3',
  'ʄ̥': 'Voiceless_palatal_implosive.ogg.mp3',
  'ʄ̊': 'Voiceless_palatal_implosive.ogg.mp3',
  'ɠ̊': 'Voiceless-velar-implosive.ogg.mp3',
  'ʛ̥': 'Voiceless-uvular-implosive.ogg.mp3',

  // ── Non-pulmonic: Ejectives ───────────────────────────────────────────────
  'pʼ': 'Bilabial_ejective_plosive.ogg.mp3',
  'tʼ': 'Alveolar_ejective_plosive.ogg.mp3',
  'ʈʼ': 'Retroflex_ejective.ogg.mp3',
  'cʼ': 'Palatal_ejective.ogg.mp3',
  'kʼ': 'Velar_ejective_plosive.ogg.mp3',
  'qʼ': 'Uvular_ejective_plosive.ogg.mp3',
  'fʼ': 'Labiodental_ejective_fricative.ogg.mp3',
  'sʼ': 'Alveolar_ejective_fricative.ogg.mp3',
  'ʂʼ': 'Retroflex_ejective_fricative.ogg.mp3',
  'ɕʼ': 'Alveolo-palatal_ejective_fricative.ogg.mp3',
  'xʼ': 'Velar_ejective_fricative.ogg.mp3',
  'χʼ': 'Uvular_ejective_fricative.ogg.mp3',
  'ɸʼ': 'Bilabial_ejective_fricative.ogg.mp3',
  'θʼ': 'Dental_ejective_fricative.ogg.mp3',
  'ʃʼ': 'Palato-alveolar_ejective_fricative.ogg.mp3',
  't̪θʼ': 'Dental_ejective_affricate.ogg.mp3',
  'tsʼ': 'Alveolar_ejective_affricate.ogg.mp3',
  'ʈʂʼ': 'Retroflex_ejective_affricate.ogg.mp3',
  't̠ʃʼ': 'Palato-alveolar_ejective_affricate.ogg.mp3',
  'kxʼ': 'Velar_ejective_affricate.ogg.mp3',
  'qχʼ': 'Uvular_ejective_affricate.ogg.mp3',
  'ɬʼ': 'Alveolar_lateral_ejective_fricative.ogg.mp3',
  'tɬʼ': 'Alveolar_lateral_ejective_affricate.ogg.mp3',
  'c𝼆ʼ': 'Palatal_lateral_ejective_affricate.ogg.mp3',
  'k𝼄ʼ': 'Velar_lateral_ejective_affricate.ogg.mp3',
  'tʂʼ': 'Retroflex_ejective_affricate.ogg.mp3',
  'tɕʼ': 'Alveolo-palatal_ejective_fricative.ogg.mp3',
  'p̪fʼ': 'Voiceless_labiodental_affricate.ogg.mp3',

  // ── Non-pulmonic: Clicks ──────────────────────────────────────────────────
  'kʘ': 'Clic_bilabial_sourd.ogg.mp3',
  'kǀ': 'Dental_click.ogg.mp3',
  'kǃ': 'Postalveolar_click.ogg.mp3',
  'kǁ': 'Alveolar_lateral_click.ogg.mp3',
  'k𝼊': 'Retrflx_click.wav.mp3',
  'kǂ': 'Palatoalveolar_click.ogg.mp3',

  // ── Co-articulated ────────────────────────────────────────────────────────
  'ʍ': 'Voiceless_labio-velar_fricative.ogg.mp3',
  'w': 'Voiced_labio-velar_approximant.ogg.mp3',
  'ɥ': 'LL-Q150_(fra)-WikiLucas00-IPA_ɥ.wav.mp3',
  'ɧ': 'Voiceless_dorso-palatal_velar_fricative.ogg.mp3',
  'ŋ͡m': 'Labial-velar_nasal_stop.ogg.mp3',
  't͡p': 'Voiceless_labial-alveolar_plosive.ogg.mp3',
  'k͡p': 'Voiceless_labial-velar_plosive.ogg.mp3',
  'ɡ͡b': 'Voiced_labial-velar_plosive.ogg.mp3',
  'q͡p': 'Voiceless_labial–uvular_plosive.ogg.mp3',
  'ɠ̊͜ɓ̥': 'Voiceless-labial–velar-implosive.ogg.mp3',
  'ɠ͡ɓ': 'Voiced-labial-velar-implosive.ogg.mp3',

  // ── Vowels ────────────────────────────────────────────────────────────────
  'i': 'Close_front_unrounded_vowel.ogg.mp3',
  'y': 'Close_front_rounded_vowel.ogg.mp3',
  'ɨ': 'Close_central_unrounded_vowel.ogg.mp3',
  'ʉ': 'Close_central_rounded_vowel.ogg.mp3',
  'ɯ': 'Close_back_unrounded_vowel.ogg.mp3',
  'u': 'Close_back_rounded_vowel.ogg.mp3',
  'ɪ': 'Near-close_near-front_unrounded_vowel.ogg.mp3',
  'ʏ': 'Near-close_near-front_rounded_vowel.ogg.mp3',
  'ʊ': 'Near-close_near-back_rounded_vowel.ogg.mp3',
  'e': 'Close-mid_front_unrounded_vowel.ogg.mp3',
  'ø': 'Close-mid_front_rounded_vowel.ogg.mp3',
  'ɘ': 'Close-mid_central_unrounded_vowel.ogg.mp3',
  'ɵ': 'Close-mid_central_rounded_vowel.ogg.mp3',
  'ɤ': 'Close-mid_back_unrounded_vowel.ogg.mp3',
  'o': 'Close-mid_back_rounded_vowel.ogg.mp3',
  'e̞': 'Mid_front_unrounded_vowel.ogg.mp3',
  'ø̞': 'Mid_front_rounded_vowel.ogg.mp3',
  'ə': 'Mid-central_vowel.ogg.mp3',
  'ɤ̞': 'ɤ̞_IPA_sound.opus.mp3',
  'o̞': 'Mid_back_rounded_vowel.ogg.mp3',
  'ɛ': 'Open-mid_front_unrounded_vowel.ogg.mp3',
  'œ': 'Open-mid_front_rounded_vowel_(2).ogg.mp3',
  'ɜ': 'Open-mid_central_unrounded_vowel.ogg.mp3',
  'ɞ': 'Open-mid_central_rounded_vowel.ogg.mp3',
  'ʌ': 'PR-open-mid_back_unrounded_vowel2.ogg.mp3',
  'ɔ': 'PR-open-mid_back_rounded_vowel.ogg.mp3',
  'æ': 'Near-open_front_unrounded_vowel.ogg.mp3',
  'ɐ': 'Near-open_central_unrounded_vowel.ogg.mp3',
  'a': 'PR-open_front_unrounded_vowel.ogg.mp3',
  'ɶ': 'Open_front_rounded_vowel.ogg.mp3',
  'ä': 'Open_central_unrounded_vowel.ogg.mp3',
  'ɑ': 'Open_back_unrounded_vowel.ogg.mp3',
  'ɒ': 'PR-open_back_rounded_vowel.ogg.mp3',
};

let currentAudio: HTMLAudioElement | null = null;

/**
 * Play the audio sample for the given IPA phoneme.
 * Silently does nothing if no mapping exists for the symbol.
 */
export function playIpaAudio(phoneme: string): void {
  const filename = IPA_AUDIO_MAP[phoneme];
  if (!filename) return;

  // Stop any currently playing audio first
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  const audio = new Audio(BASE + encodeURIComponent(filename).replace(/%2F/g, '/'));
  currentAudio = audio;
  audio.play().catch(() => {
    // Autoplay policy or file-not-found — silently ignore
  });
}

/** Returns true if an audio sample exists for the given phoneme. */
export function hasIpaAudio(phoneme: string): boolean {
  return phoneme in IPA_AUDIO_MAP;
}
