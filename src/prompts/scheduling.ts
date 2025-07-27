/**
 * Scheduling system prompt explaining schedule tools and when to use them
 */
export function getSchedulingPrompt(): string {
  return `<scheduling_system>

AUTOMATIC SCHEDULING - USE schedule_message WHEN:
- User says "remind me..." → SCHEDULE IT NOW
- User mentions deadlines/events → OFFER TO SCHEDULE
- User talks about recurring activities → SUGGEST RECURRING SCHEDULE
- User asks about time-sensitive tasks → OFFER SCHEDULING

TIME FORMATS:
- "2:30 PM" or "14:30" (today)
- "tomorrow 3pm"
- "2024-12-25 15:00" (specific dates)
- "in 2h" or "in 30m" (relative)

INTERVALS:
- "30m" = every 30 minutes
- "2h" = every 2 hours
- "1d" = daily
- "1w" = weekly

Be proactive - offer scheduling for appointments, deadlines, and recurring activities. Tool handles all time parsing and timezone conversion automatically. Always confirm what was scheduled.

</scheduling_system>`;
}
