/**
 * One icon per workspace, shared by the "Your workspaces" hub (server) and the
 * header's workspace switcher (client) so both always match. Same icons the
 * demo role picker used, so returning users recognise them.
 */

import {
  PenSquare,
  ShieldCheck,
  Users,
  BarChart3,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceId } from "@/lib/workspaces";

export const WORKSPACE_ICONS: Record<WorkspaceId, LucideIcon> = {
  content: PenSquare,
  admin: ShieldCheck,
  facilitator: Users,
  analytics: BarChart3,
  learner: GraduationCap,
};
