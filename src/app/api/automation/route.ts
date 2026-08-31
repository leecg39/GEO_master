import { NextRequest, NextResponse } from "next/server";
import {
  automationActionSchema,
  cancelJob,
  createSchedule,
  deleteSchedule,
  getAutomationState,
  processAutomationQueue,
  retryJob,
  runScheduleNow,
  startAutomationWorker,
  toggleSchedule,
  updateAutomationPolicy,
  updateSchedule,
} from "@/lib/automation";
import { errorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET() {
  try {
    return NextResponse.json(getAutomationState());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = automationActionSchema.parse(await request.json());
    let result: unknown;
    switch (input.action) {
      case "schedule.create":
        result = createSchedule(input.schedule);
        break;
      case "schedule.update":
        result = updateSchedule(input.id, input.schedule);
        break;
      case "schedule.toggle":
        result = toggleSchedule(input.id, input.enabled);
        break;
      case "schedule.delete":
        result = deleteSchedule(input.id);
        break;
      case "schedule.runNow":
        result = runScheduleNow(input.id);
        break;
      case "job.cancel":
        result = cancelJob(input.id);
        break;
      case "job.retry":
        result = retryJob(input.id);
        break;
      case "policy.update":
        result = updateAutomationPolicy(input.policy);
        break;
      case "queue.process":
        result = await processAutomationQueue();
        break;
    }
    startAutomationWorker();
    return NextResponse.json({ result, state: getAutomationState() }, { status: input.action === "schedule.create" ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
