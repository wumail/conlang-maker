import React, { useState, useRef, useEffect } from "react";
import { CircleX, ChevronDown } from "lucide-react";

interface TagSelectorProps {
    selected: string[];
    options: string[];
    onChange: (selected: string[]) => void;
    placeholder?: string;
}

/**
 * Multi-select tag selector with chip display and dropdown.
 * Inspired by Ant Design's Custom Tag Render.
 */
export const TagSelector: React.FC<TagSelectorProps> = ({
    selected,
    options,
    onChange,
    placeholder,
}) => {
    const [filterText, setFilterText] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const filteredOptions = options.filter(
        (opt) =>
            opt.toLowerCase().includes(filterText.toLowerCase()) &&
            !selected.includes(opt),
    );

    const toggleTag = (tag: string) => {
        if (selected.includes(tag)) {
            onChange(selected.filter((t) => t !== tag));
        } else {
            onChange([...selected, tag]);
        }
        setFilterText("");
        inputRef.current?.focus();
    };

    const removeTag = (tag: string) => {
        onChange(selected.filter((t) => t !== tag));
    };

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace" && !filterText && selected.length > 0) {
            removeTag(selected[selected.length - 1]);
        } else if (e.key === "Escape") {
            setIsOpen(false);
        }
    };

    return (
        <div ref={containerRef} className="relative w-full">
            <div
                className="input input-xs flex flex-wrap items-center gap-1.5 min-h-[1.75rem] h-auto cursor-text pr-6 py-1 px-2"
                onClick={() => {
                    setIsOpen(true);
                    inputRef.current?.focus();
                }}
            >
                {selected.map((tag) => (
                    <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-base-300 bg-base-200 text-[10px] font-bold uppercase tracking-wide text-base-content shrink-0"
                    >
                        {tag}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeTag(tag);
                            }}
                        >
                            <CircleX className="text-base-content/50 hover:text-base-content" size={12} />
                        </button>
                    </span>
                ))}
                <input
                    ref={inputRef}
                    type="text"
                    value={filterText}
                    onChange={(e) => {
                        setFilterText(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 min-w-[60px] outline-none bg-transparent text-xs"
                    placeholder={selected.length === 0 ? placeholder : ""}
                />
                <ChevronDown
                    size={12}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-base-content/40"
                />
            </div>

            {isOpen && (filteredOptions.length > 0 || selected.length > 0) && (
                <ul className="absolute z-50 mt-1 w-full bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-32 overflow-y-auto">
                    {filteredOptions.length === 0 && (
                        <li className="px-2 py-1.5 text-xs text-base-content/40 italic">
                            —
                        </li>
                    )}
                    {filteredOptions.slice(0, 30).map((opt) => (
                        <li
                            key={opt}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                toggleTag(opt);
                            }}
                            className="px-2 py-1 text-xs cursor-pointer hover:bg-base-200"
                        >
                            {opt}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
