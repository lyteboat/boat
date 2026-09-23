/**
 * boat adaptation: upstream type-checks the driver's tests in one program with
 * every dsh package, where `@deepseek-ai/dsh-agent-instructions` declares the
 * `agent-instructions` message source that loop.spec.ts injects. boat's test
 * program holds only the packages boat imports, so this file brings that
 * declaration in.
 */
import type {} from '@deepseek-ai/dsh-agent-instructions'
