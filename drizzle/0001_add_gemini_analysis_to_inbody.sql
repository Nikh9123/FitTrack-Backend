-- Add geminiAnalysis column to inbody_reports table
ALTER TABLE "inbody_reports" ADD COLUMN "gemini_analysis" jsonb;

-- Add comment explaining the column
COMMENT ON COLUMN "inbody_reports"."gemini_analysis" IS 'Gemini AI analysis result containing overall summary, fitness level, body composition analysis, metabolism insights, strengths, weaknesses, health risks, recommendations, and personalized workout/diet plans';
