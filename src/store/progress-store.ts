import { create } from "zustand";

import type { TCFSkill } from "@/src/types/cefr";
import type { SkillProgress, DailyActivity } from "@/src/types/user";

interface ProgressState {
  /** Per-skill progress records */
  skills: Record<TCFSkill, SkillProgress | null>;
  /** Today's activity */
  todayActivity: DailyActivity | null;
  /** Current streak */
  streakDays: number;

  setSkillProgress: (skill: TCFSkill, progress: SkillProgress) => void;
  setAllSkills: (skills: SkillProgress[]) => void;
  setTodayActivity: (activity: DailyActivity) => void;
  setStreak: (days: number) => void;
  reset: () => void;
}

const emptySkills: Record<TCFSkill, SkillProgress | null> = {
  listening: null,
  reading: null,
  speaking: null,
  writing: null,
  grammar: null,
};

export const useProgressStore = create<ProgressState>((set) => ({
  skills: { ...emptySkills },
  todayActivity: null,
  streakDays: 0,

  setSkillProgress: (skill, progress) =>
    set((state) => ({
      skills: { ...state.skills, [skill]: progress },
    })),

  setAllSkills: (skills) =>
    set(() => {
      const mapped = { ...emptySkills };
      for (const s of skills) {
        mapped[s.skill] = s;
      }
      return { skills: mapped };
    }),

  setTodayActivity: (activity) => set({ todayActivity: activity }),

  setStreak: (days) => set({ streakDays: days }),

  reset: () =>
    set({
      skills: { ...emptySkills },
      todayActivity: null,
      streakDays: 0,
    }),
}));
