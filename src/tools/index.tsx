/**
 * Register smart tools here; main.tsx imports this file once at startup.
 */
import { registerTool } from "./registry";
import { contextTool } from "./context";

registerTool(contextTool);
