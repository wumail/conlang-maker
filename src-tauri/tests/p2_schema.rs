//! T2.1 — P2 持久化 Schema 向后兼容回归
//!
//! 三条不变量：
//! 1. 旧 JSON（不含任何新字段）反序列化后再序列化，**不得出现新键**；
//! 2. 含新字段的 JSON 可完整往返；
//! 3. `Phonotactics.stress` 始终由 `extra` 透传（省略 / null / 对象三种形态字节不变）。

use conlang_maker_lib::models::{Etymology, GrammarConfig, Phonotactics, Sense, WorkspaceConfig};
use serde_json::{json, Value};

fn round_trip<T>(input: Value) -> Value
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let parsed: T = serde_json::from_value(input).expect("deserialize");
    serde_json::to_value(parsed).expect("serialize")
}

#[test]
fn legacy_sense_and_etymology_gain_no_new_keys() {
    let sense_input = json!({
        "sense_id": "sense_1",
        "pos_id": "noun",
        "gloss": "stone",
        "definitions": [],
        "examples": []
    });
    let sense = round_trip::<Sense>(sense_input.clone());
    assert_eq!(sense, sense_input);
    assert!(sense.get("concept_id").is_none());

    let etymology_input = json!({
        "origin_type": "a_priori",
        "parent_entry_id": null,
        "source_language_id": null,
        "applied_sound_changes": [],
        "semantic_shift_note": ""
    });
    let etymology = round_trip::<Etymology>(etymology_input.clone());
    assert_eq!(etymology, etymology_input);
    assert!(etymology.get("components").is_none());
    assert!(etymology.get("compounds_stale_digest").is_none());
}

#[test]
fn new_word_level_fields_round_trip() {
    let sense = round_trip::<Sense>(json!({
        "sense_id": "sense_1",
        "pos_id": "noun",
        "gloss": "water",
        "definitions": [],
        "examples": [],
        "concept_id": "CONCEPT_WATER"
    }));
    assert_eq!(sense["concept_id"], "CONCEPT_WATER");

    let etymology = round_trip::<Etymology>(json!({
        "origin_type": "derived",
        "parent_entry_id": "entry_root",
        "source_language_id": null,
        "applied_sound_changes": [],
        "semantic_shift_note": "",
        "components": [
            { "entry_id": "entry_a", "relation": "root" },
            { "entry_id": "entry_b", "relation": "modifier", "surface_override": "b" }
        ],
        "compounds_stale_digest": "digest_1"
    }));
    assert_eq!(etymology["components"].as_array().unwrap().len(), 2);
    assert_eq!(etymology["components"][0]["relation"], "root");
    assert_eq!(etymology["compounds_stale_digest"], "digest_1");
}

#[test]
fn workspace_custom_concepts_is_optional() {
    let legacy = json!({
        "workspace_version": "3.0",
        "languages": [{
            "language_id": "lang_proto",
            "name": "Proto",
            "path": "proto_language",
            "parent_id": null
        }]
    });
    let unchanged = round_trip::<WorkspaceConfig>(legacy.clone());
    assert_eq!(unchanged, legacy);
    assert!(unchanged.get("custom_concepts").is_none());

    let with_concepts = round_trip::<WorkspaceConfig>(json!({
        "workspace_version": "3.0",
        "languages": [],
        "custom_concepts": [{
            "concept_id": "CUSTOM_CALENDAR_MONTH",
            "gloss_en": "month",
            "gloss_zh": "月",
            "semantic_field": "calendar",
            "standard_lists": ["swadesh_100"]
        }]
    }));
    assert_eq!(
        with_concepts["custom_concepts"][0]["concept_id"],
        "CUSTOM_CALENDAR_MONTH"
    );
    assert!(with_concepts["custom_concepts"][0]
        .get("concepticon_id")
        .is_none());
}

#[test]
fn grammar_morphophonology_rules_is_optional() {
    let legacy = round_trip::<GrammarConfig>(json!({ "language_id": "lang_a" }));
    assert!(legacy.get("morphophonology_rules").is_none());
    assert!(legacy.get("syntax").unwrap().get("alignment").is_none());

    let with_rules = round_trip::<GrammarConfig>(json!({
        "language_id": "lang_a",
        "syntax": {
            "word_order": "SOV",
            "modifier_position": "before",
            "adposition_type": "postposition",
            "alignment": "erg_abs"
        },
        "morphophonology_rules": [{
            "rule_id": "mph_1",
            "description": "voicing",
            "priority": 1,
            "target": "t",
            "replacement": "d",
            "context_before": "V",
            "context_after": "V",
            "feature_mode": false
        }]
    }));
    assert_eq!(with_rules["syntax"]["alignment"], "erg_abs");
    assert_eq!(with_rules["morphophonology_rules"][0]["rule_id"], "mph_1");
    assert!(with_rules["morphophonology_rules"][0]
        .get("disabled")
        .is_none());
}

#[test]
fn phonotactics_stress_passes_through_three_forms() {
    let absent = json!({
        "macros": {},
        "syllable_structure": "CV",
        "blacklist_patterns": [],
        "vowel_harmony": { "enabled": false, "group_a": [], "group_b": [] },
        "tone_system": { "enabled": false, "tones": [] }
    });
    let round_tripped = round_trip::<Phonotactics>(absent.clone());
    assert_eq!(round_tripped, absent);
    assert!(round_tripped.get("stress").is_none());

    let null_stress = {
        let mut value = absent.clone();
        value["stress"] = Value::Null;
        value
    };
    let round_tripped = round_trip::<Phonotactics>(null_stress.clone());
    assert_eq!(round_tripped, null_stress);

    let object_stress = {
        let mut value = absent;
        value["stress"] = json!({ "position": "penultimate", "domain": "word" });
        value
    };
    let round_tripped = round_trip::<Phonotactics>(object_stress.clone());
    assert_eq!(round_tripped, object_stress);
    assert_eq!(
        round_tripped["stress"]["position"],
        Value::String("penultimate".to_string())
    );
}

#[test]
fn morpheme_component_keeps_unknown_fields() {
    let value = round_trip::<Etymology>(json!({
        "origin_type": "derived",
        "parent_entry_id": null,
        "source_language_id": null,
        "applied_sound_changes": [],
        "semantic_shift_note": "",
        "components": [
            { "entry_id": "entry_a", "relation": "root", "x_future_field": "keep" }
        ]
    }));
    assert_eq!(value["components"][0]["x_future_field"], "keep");
}
