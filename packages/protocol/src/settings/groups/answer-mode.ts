// Rules-matrix rows 21-22: how answers are captured. everyone-answers is the escape valve for
// 50-100 solo players where buzz-racing breaks down (expansion 1.1) - all phones answer every
// clue within a timer instead of racing for one buzz.
import { z } from "zod";
import { defineSetting, defineSettingsGroup } from "../definition.ts";

export const answerModeGroup = defineSettingsGroup({
  id: "answerMode",
  label: "Answer mode",
  description: "Verbal or typed answers, and the everyone-answers crowd mode.",
  settings: {
    answerCapture: defineSetting({
      matrixRow: 21,
      label: "Answer capture",
      description:
        "verbal: the host judges spoken answers, the app tracks buzz order and scores (the faithful live-event default). typed: answers are typed on phones and auto-judged with host override.",
      schema: z.enum(["verbal", "typed"]).default("verbal"),
    }),
    everyoneAnswers: defineSetting({
      matrixRow: 22,
      label: "Everyone answers",
      description:
        "No buzzer race: every player types an answer within the timer. speed-weighted decays points by answer speed. Suggested on for 30+ solo players.",
      constraints: "Requires typed answer capture.",
      schema: z.enum(["off", "on", "speed-weighted"]).default("off"),
    }),
  },
  refinements: [
    {
      id: "everyone-answers-needs-typed",
      description:
        "Everyone-answers mode needs typed capture - there is no buzz winner to judge verbally.",
      path: "everyoneAnswers",
      valid: (value) => value.everyoneAnswers === "off" || value.answerCapture === "typed",
    },
  ],
});
