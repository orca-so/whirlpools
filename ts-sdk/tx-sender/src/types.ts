type NoPriority = {
  mode: "none";
};

type ManualPriorityConfig = {
  mode: "jitoOnly" | "priorityFeeOnly" | "both";
  fee: { lamports: number; isExact: boolean };
};

export type PrioritizationConfig = ManualPriorityConfig | NoPriority;
