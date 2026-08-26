/**
 * Minimal ambient augmentation of the Cordis `Context` for the two DeepSeek
 * Harness services this plugin calls (`ctx.subprocess`, `ctx.commands`).
 *
 * Why local shims instead of importing the real augmentation packages
 * (`@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-commands`): those preview
 * packages pull unpublished transitive deps (`@deepseek-ai/dsh-environment`),
 * so they can't be installed standalone from npm. At runtime the actual services
 * are provided by the running dsh (tsdown externalizes `@deepseek-ai/*`), so we
 * only need the shapes to typecheck against. Keep this in sync with the real
 * seams in `ref/dsh/packages/{subprocess,interaction/commands}`.
 */

import "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface SubprocessOutputMode {
    maxBytes: number;
  }

  interface SubprocessSpawnSpec {
    argv: readonly string[];
    cwd: string;
    stdio: {
      stdin: "ignore" | "pipe";
      stdout: "inherit" | "pipe" | { maxBytes: number };
      stderr: "inherit" | "pipe" | { maxBytes: number };
    };
    graceMs: number;
    env?: NodeJS.ProcessEnv;
  }

  interface SubprocessHandle {
    done: Promise<{ exitCode: number | null }>;
  }

  interface SubprocessService {
    resolveExecutable(
      command: string,
      env?: NodeJS.ProcessEnv,
      signal?: AbortSignal,
    ): Promise<string>;
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
  }

  interface CommandResult {
    kind: "success" | "error";
    text?: string;
  }

  interface CommandDefinition {
    name: string;
    description: string;
    handler: (invocation: unknown) => CommandResult | Promise<CommandResult>;
  }

  interface CommandsService {
    register(definition: CommandDefinition): () => void;
  }

  interface UserQuestionOption {
    label: string;
    description?: string;
  }

  interface UserQuestionItem {
    id: string;
    question: string;
    detail?: string;
    header?: string;
    options?: UserQuestionOption[];
    multiSelect?: boolean;
  }

  interface UserQuestionAnswerItem {
    id: string;
    selected: string[];
    custom?: string;
  }

  interface UserQuestionAnswer {
    answers: UserQuestionAnswerItem[];
  }

  interface UserQuestionsService {
    ask(request: {
      questions: UserQuestionItem[];
      signal?: AbortSignal;
    }): Promise<UserQuestionAnswer>;
  }

  interface Context {
    subprocess: SubprocessService;
    commands: CommandsService;
    userQuestions: UserQuestionsService;
  }
}
