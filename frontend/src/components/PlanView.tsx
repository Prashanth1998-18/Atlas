import { ReactNode } from "react";
import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";

type StepStatus = "pending" | "in_progress" | "completed" | "failed";
type PlanStatus = "planning" | "executing" | "synthesizing" | "completed";

interface PlanStep {
  id: number;
  description: string;
  status: StepStatus;
}

interface Plan {
  steps: PlanStep[];
  current_step: number | null;
  status: PlanStatus;
  status_message: string | null;
}

interface PlanViewProps {
  plan: Plan;
}

const BASE_STEP_CLASS = "flex items-start gap-2.5 p-2 rounded-lg text-[13px] transition-colors";

function getStepIcon(status: StepStatus): ReactNode {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    case "in_progress":
      return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />;
    case "failed":
      return <XCircle className="w-3.5 h-3.5 text-destructive" />;
    case "pending":
      return <Circle className="w-3.5 h-3.5 text-muted-foreground/30" />;
  }
}

function getStepClassName(status: StepStatus): string {
  switch (status) {
    case "completed":
      return `${BASE_STEP_CLASS} text-muted-foreground/70`;
    case "in_progress":
      return `${BASE_STEP_CLASS} text-primary bg-primary/5 font-medium`;
    case "failed":
      return `${BASE_STEP_CLASS} text-destructive bg-destructive/5`;
    case "pending":
      return `${BASE_STEP_CLASS} text-muted-foreground opacity-60`;
  }
}

export default function PlanView({ plan }: PlanViewProps): ReactNode {
  const showStatusBadge = plan.status !== "completed" && plan.status_message;
  
  return (
    <div className="bg-background/40 border border-border/50 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-primary/10 rounded-md">
            <span className="text-[10px]">📋</span>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Execution Plan</span>
        </div>
        {showStatusBadge && (
          <span className="text-[10px] bg-secondary px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter text-primary animate-pulse">
            {plan.status}
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {plan.steps.map((step) => (
          <div key={step.id} className={getStepClassName(step.status)}>
            <div className="flex-shrink-0 mt-0.5">{getStepIcon(step.status)}</div>
            <span className="flex-1 leading-snug">{step.description}</span>
          </div>
        ))}
      </div>
      {plan.status === "synthesizing" && (
        <div className="mt-4 pt-3 border-t border-border/20">
          <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground italic">
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
            <span>Compiling intelligence...</span>
          </div>
        </div>
      )}
    </div>
  );
}


