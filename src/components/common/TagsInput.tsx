import React, { useState, useRef, useEffect, useCallback } from "react";
import { CircleX } from "lucide-react";

interface TagsInputProps {
    tags: string[];
    onChange: (tags: string[]) => void;
    placeholder?: string;
    allTags?: string[];
}

/**
 * Tag input component: renders tags as pill chips alongside a separate text input.
 * Enter/comma adds a tag, Backspace removes the last tag, ✕ removes a specific tag.
 * Optional autocomplete via `allTags`.
 */
export const TagsInput: React.FC<TagsInputProps> = ({
    tags,
    onChange,
    placeholder,
    allTags,
}) => {
    const [inputValue, setInputValue] = useState("");
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [highlightIdx, setHighlightIdx] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const addTag = useCallback(
        (tag: string) => {
            const trimmed = tag.trim();
            if (trimmed && !tags.includes(trimmed)) {
                onChange([...tags, trimmed]);
            }
            setInputValue("");
            setShowSuggestions(false);
            setHighlightIdx(-1);
        },
        [tags, onChange],
    );

    const removeTag = useCallback(
        (index: number) => {
            onChange(tags.filter((_, i) => i !== index));
        },
        [tags, onChange],
    );

    const suggestions = allTags
        ? allTags.filter(
            (t) =>
                (!inputValue.trim() ||
                    t.toLowerCase().includes(inputValue.toLowerCase())) &&
                !tags.includes(t),
        )
        : [];

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            if (highlightIdx >= 0 && highlightIdx < suggestions.length) {
                addTag(suggestions[highlightIdx]);
            } else if (inputValue.trim()) {
                addTag(inputValue);
            }
        } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
            removeTag(tags.length - 1);
        } else if (e.key === "ArrowDown" && suggestions.length > 0) {
            e.preventDefault();
            setHighlightIdx((prev) =>
                prev < suggestions.length - 1 ? prev + 1 : 0,
            );
        } else if (e.key === "ArrowUp" && suggestions.length > 0) {
            e.preventDefault();
            setHighlightIdx((prev) =>
                prev > 0 ? prev - 1 : suggestions.length - 1,
            );
        } else if (e.key === "Escape") {
            setShowSuggestions(false);
            setHighlightIdx(-1);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if (val.endsWith(",")) {
            const tagPart = val.slice(0, -1);
            if (tagPart.trim()) addTag(tagPart);
            return;
        }
        setInputValue(val);
        setShowSuggestions(true);
        setHighlightIdx(-1);
    };

    // Close suggestions on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    return (
        <div ref={containerRef} className="flex-1">
            {/* Tags + input laid out as siblings in a row */}
            <div className="flex flex-wrap items-center gap-3">
                {tags.map((tag, i) => (
                    <span
                        key={tag}
                        className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded border border-base-300 bg-base-300 text-base-content text-xs font-bold uppercase tracking-wide shrink-0"
                    >
                        {tag}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeTag(i);
                            }}
                            className="transition-colors"
                        >
                            <CircleX className="text-base-content/50 hover:text-base-content" size={16} />
                        </button>
                    </span>
                ))}
                {/* Input + dropdown wrapper: dropdown aligns under the input */}
                <div className="relative min-w-[120px]">
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        onFocus={() => setShowSuggestions(true)}
                        className="input input-md w-full"
                        placeholder={placeholder ?? "Type here"}
                    />
                    {/* Autocomplete dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                        <ul className="absolute z-50 mt-1 w-full bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {suggestions.slice(0, 20).map((s, i) => (
                                <li
                                    key={s}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        addTag(s);
                                    }}
                                    className={`px-3 py-1.5 text-sm cursor-pointer ${i === highlightIdx
                                        ? "bg-primary/15 text-primary"
                                        : "hover:bg-base-200"
                                        }`}
                                >
                                    {s}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};
