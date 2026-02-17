"use client";

import { Beaker } from "lucide-react";

interface Scenario {
  id: string;
  label: string;
  description?: string;
}

interface ScenarioSelectorProps {
  scenarios: Scenario[];
  activeScenario: string;
  onSelect: (id: string) => void;
}

export default function ScenarioSelector({
  scenarios,
  activeScenario,
  onSelect,
}: ScenarioSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs text-[#71717a] mr-1">
        <Beaker size={14} />
        <span>Presets</span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {scenarios.map((scenario) => (
          <button
            key={scenario.id}
            onClick={() => onSelect(scenario.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
              activeScenario === scenario.id
                ? "bg-[#6366f1]/15 text-[#6366f1] border border-[#6366f1]/30"
                : "bg-[#1e1e2e] text-[#a1a1aa] border border-transparent hover:bg-[#2a2a3e] hover:text-white"
            }`}
            title={scenario.description}
          >
            {scenario.label}
          </button>
        ))}
      </div>
    </div>
  );
}
