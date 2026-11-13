import { sendInstructorNotifications } from "../../src/lib/instructor-notifications";

export default async () => {
  await sendInstructorNotifications(undefined, 2);
};

export const config = { schedule: "*/5 * * * *" };
