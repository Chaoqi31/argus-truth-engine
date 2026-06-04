import { sortFindingsForReview } from "@/lib/findings";
import type { Finding, Job } from "@/lib/types";

export function orderFindingsForDemoReplay(job: Job): Finding[] {
  return sortFindingsForReview(job.findings);
}
