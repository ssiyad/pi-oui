// The CSP blocks eval. Zod tests for eval with new Function(), and the browser
// reports each blocked test. Tell zod not to try.
import { z } from "zod";

z.config({ jitless: true });
