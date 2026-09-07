"use client";

import { useState, useCallback, useEffect } from "react";

interface CustomSliderProps {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  onChange?: (value: number) => void;
  label?: string;
  showValue?: boolean;
  unit?: string;
  className?: string;
}

export function CustomSlider({
  min = 0,
  max = 100,
  step = 1,
  value = 50,
  onChange,
  label,
  showValue = true,
  unit = "",
  className = "",
}: CustomSliderProps) {
  const [internalValue, setInternalValue] = useState(value);

  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = Number(e.target.value);
      setInternalValue(newValue);
      onChange?.(newValue);
    },
    [onChange]
  );

  const percentage = ((internalValue - min) / (max - min)) * 100;

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <div className="flex items-center justify-between mb-3">
          <label className="text-sm font-medium text-foreground">{label}</label>
          {showValue && (
            <span className="text-sm font-semibold text-accent">
              {internalValue}
              {unit}
            </span>
          )}
        </div>
      )}

      <div className="relative w-full h-2 bg-gradient-to-r from-accent/20 to-accent/10 rounded-full overflow-hidden">
        {/* Fill background */}
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-accent to-accent/80 rounded-full transition-all duration-150"
          style={{ width: `${percentage}%` }}
        />

        {/* Slider input */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={internalValue}
          onChange={handleChange}
          className="absolute w-full h-full opacity-0 cursor-pointer z-10"
          style={{
            WebkitAppearance: "none",
          }}
        />

        {/* Custom thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-foreground rounded-full shadow-lg pointer-events-none transition-all duration-150 border-2 border-background"
          style={{
            left: `${percentage}%`,
          }}
        />
      </div>

      {/* Track labels */}
      <div className="flex justify-between mt-2 text-xs text-muted-foreground">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
