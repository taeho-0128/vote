import { z } from 'zod';

export const INK_WIDTH = 1000;
export const INK_HEIGHT = 1333;
export const INK_MAX_STROKES = 300;
export const INK_MAX_POINTS_PER_STROKE = 2000;
export const INK_MAX_POINTS = 5000;

export const inkStrokeSchema = z.object({
  w: z.enum(['thin', 'thick']),
  pts: z
    .array(z.number().int().min(0).max(INK_HEIGHT))
    .min(2)
    .max(INK_MAX_POINTS_PER_STROKE * 2)
    .refine((pts) => pts.length % 2 === 0),
});

export const inkSchema = z.array(inkStrokeSchema).max(INK_MAX_STROKES);

export type InkStroke = z.infer<typeof inkStrokeSchema>;

export function inkPointCount(strokes: readonly InkStroke[]): number {
  return strokes.reduce((sum, s) => sum + s.pts.length / 2, 0);
}

export function normalizeInk(strokes: readonly InkStroke[]): InkStroke[] | null {
  if (strokes.length < 1) return null;
  if (inkPointCount(strokes) > INK_MAX_POINTS) return null;
  for (const s of strokes) {
    for (let i = 0; i < s.pts.length; i += 2) {
      if (s.pts[i]! > INK_WIDTH) return null;
    }
  }
  return strokes.map((s) => ({ w: s.w, pts: [...s.pts] }));
}
