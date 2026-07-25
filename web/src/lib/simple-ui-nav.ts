export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  /** Icon-only control (e.g. settings gear), pinned last in the bar */
  icon?: "gear";
}

export const FULL_NAV: NavItem[] = [
  { to: "/app", end: true, label: "Overview" },
  { to: "/app/checkpoints", label: "Checkpoints" },
  { to: "/app/experiments", label: "Experiments" },
  { to: "/app/analytics", label: "Analytics" },
  { to: "/app/knowledge", label: "Knowledge" },
  { to: "/app/platforms", label: "Platforms" },
  { to: "/app/carousels", label: "Carousels" },
  { to: "/app/settings", label: "Settings", icon: "gear" },
];

/** Chat is home; agent owns the loop (RAG, MD, tools). */
export const SIMPLE_NAV: NavItem[] = [
  { to: "/app", end: true, label: "Chat" },
  { to: "/app/testing-plan", label: "Plan" },
  { to: "/app/insights", label: "Insights" },
  { to: "/app/test", label: "Test" },
  { to: "/app/experiments", label: "Experiments" },
  { to: "/app/analytics", label: "Analytics" },
  { to: "/app/settings", label: "Settings", icon: "gear" },
];

export const FULL_ONLY_PREFIXES = [
  "/app/checkpoints",
  "/app/knowledge",
  "/app/platforms",
  "/app/carousels",
] as const;

export const SIMPLE_ONLY_PREFIXES = [
  "/app/testing-plan",
  "/app/insights",
  "/app/test",
] as const;

export const PLAN_CHECKPOINT_STAGES = [
  "RoadmapReview",
  "HypothesisReview",
  "ContentReview",
  "PublishingApproval",
  "NextIterationPlanning",
] as const;

export function isFullOnlyPath(pathname: string): boolean {
  return FULL_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function isSimpleOnlyPath(pathname: string): boolean {
  return SIMPLE_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function navForMode(simpleUi: boolean): NavItem[] {
  return simpleUi ? SIMPLE_NAV : FULL_NAV;
}
