import type { ApplicationProfile, ExpertAssessment } from "@aegis/shared";
import type { LLMProvider } from "../llm/provider.js";

/**
 * Base interface every expert module (Sentinel, Watchdog, Guardian) implements.
 */
export interface ExpertModule {
  /** Module identifier — must match an ExpertModuleId value */
  readonly id: string;

  /** Human-readable name shown in reports */
  readonly name: string;

  /**
   * Run the expert's analysis on a profiled application.
   *
   * @param app  - The intake-stage application profile (files, deps, AI integrations, …)
   * @param llm  - The LLM provider resolved for this module by the registry
   * @returns A fully populated ExpertAssessment
   */
  analyze(app: ApplicationProfile, llm: LLMProvider): Promise<ExpertAssessment>;
}
