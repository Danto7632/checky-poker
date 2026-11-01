import { useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useI18n } from "../i18n";

const loadingSteps = [
  "Connecting to Server...",
  "Loading Assets...",
  "Initializing AI Bots...",
  "Preparing Lobby...",
];

export function LoadingScreen() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    // 순차적으로 로딩 텍스트를 변경합니다
    const textInterval = setInterval(() => {
      setStepIndex((prev) => (prev < loadingSteps.length - 1 ? prev + 1 : prev));
    }, 700);

    // 3.5초 후 로비로 이동
    const timer = setTimeout(() => {
      navigate("/lobby");
    }, 3500);

    return () => {
      clearInterval(textInterval);
      clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <div className="relative flex flex-col items-center justify-center w-full h-full bg-[#1A1A4A] overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]" />

      {/* Main Content container */}
      <div className="z-10 flex flex-col items-center gap-6">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center"
        >
          <h1 className="text-6xl md:text-8xl font-black text-white tracking-widest drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] uppercase">
            AIPOT
          </h1>
          <p className="text-2xl font-bold text-[#FFD700] uppercase tracking-[0.2em] mt-2 drop-shadow-md">
            {t("AI Poker Trainer\\nPlay, Analyze, and Improve.").split("\\n")[0]}
          </p>
        </motion.div>

        {/* Loading Indicator */}
        <div className="flex flex-col items-center mt-12 gap-3 w-72">
          <AnimatePresence mode="wait">
            <motion.p
              key={stepIndex}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-sm font-bold text-cyan-300 uppercase tracking-widest"
            >
              {t(loadingSteps[stepIndex])}
            </motion.p>
          </AnimatePresence>
          
          <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden border-2 border-slate-700 relative">
            <motion.div
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 3.3, ease: "easeInOut" }}
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500"
            />
            {/* Shimmer effect */}
            <motion.div
              animate={{ x: ["-100%", "200%"] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
              className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/30 to-transparent"
            />
          </div>
        </div>
      </div>
      
      {/* Decorative Elements */}
      <div className="absolute -bottom-10 right-10 flex gap-4 opacity-30 blur-[2px]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="w-32 h-32 rounded-full border-[8px] border-dashed border-cyan-500 bg-cyan-400 flex items-center justify-center"
        >
          <div className="w-16 h-16 rounded-full bg-cyan-500 border-4 border-cyan-600"></div>
        </motion.div>
        <motion.div 
          animate={{ rotate: -360 }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="w-24 h-24 rounded-full border-[6px] border-dashed border-indigo-500 bg-indigo-400 flex items-center justify-center mt-12 -ml-8"
        >
           <div className="w-12 h-12 rounded-full bg-indigo-500 border-2 border-indigo-600"></div>
        </motion.div>
      </div>
    </div>
  );
}
