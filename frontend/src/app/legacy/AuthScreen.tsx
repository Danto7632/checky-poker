import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { LogIn, UserPlus, Users } from "lucide-react";
import { ensureAuthSeedData, signInGuest, signInUser, signUpUser } from "../auth";
import { useI18n } from "../i18n";

const AUTH_EN = {
  signIn: "Sign In",
  signUp: "Sign Up",
  idNickname: "ID (Nickname)",
  password: "Password",
  confirmPassword: "Confirm Password",
  createAccount: "Create Account",
  failedGuestSignIn: "Failed to sign in as guest.",
  enterBothNicknameAndPassword: "Enter both nickname and password.",
  failedSignIn: "Failed to sign in. Check your ID and password.",
  passwordMinLength: "Password must be at least 4 characters.",
  passwordMismatch: "Password confirmation does not match.",
  failedCreateAccount: "Failed to create account. Please try another ID.",
} as const;

export function AuthScreen() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    ensureAuthSeedData();
  }, []);

  const resetMessage = () => {
    if (errorMessage) setErrorMessage("");
  };

  const handleGuestLogin = async () => {
    const result = await signInGuest();
    if (!result.ok) {
      setErrorMessage(AUTH_EN.failedGuestSignIn);
      return;
    }

    navigate("/loading");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessage();

    const trimmedNickname = nickname.trim();
    if (!trimmedNickname || !password) {
      setErrorMessage(AUTH_EN.enterBothNicknameAndPassword);
      return;
    }

    if (mode === "signin") {
      const result = await signInUser(trimmedNickname, password);
      if (!result.ok) {
        setErrorMessage(AUTH_EN.failedSignIn);
        return;
      }

      navigate("/loading");
      return;
    }

    if (password.length < 4) {
      setErrorMessage(AUTH_EN.passwordMinLength);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage(AUTH_EN.passwordMismatch);
      return;
    }

    const signUpResult = await signUpUser(trimmedNickname, password);
    if (!signUpResult.ok) {
      setErrorMessage(AUTH_EN.failedCreateAccount);
      return;
    }

    navigate("/loading");
  };

  return (
     <div className="relative flex flex-col items-center justify-center w-full h-full bg-[#11122D] overflow-hidden text-white select-none">
        {/* Background Texture */}
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 pointer-events-none" />

        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="z-10 bg-[#1A1C3E] p-8 md:p-10 rounded-[32px] border border-white/10 shadow-2xl flex flex-col items-center w-full max-w-md mx-4"
        >
           <h1 className="text-5xl md:text-6xl font-black italic tracking-wider mb-2 text-cyan-400 drop-shadow-[0_0_15px_rgba(6,182,212,0.5)]">AIPOT</h1>
           <p className="text-slate-400 font-bold mb-8 text-center text-sm md:text-base">
             {t("AI Poker Trainer\\nPlay, Analyze, and Improve.").split("\\n").map((line, idx) => (
               <span key={`auth-subtitle-${idx}`}>
                 {line}
                 {idx === 0 ? <br /> : null}
               </span>
             ))}
           </p>

           <div className="w-full grid grid-cols-2 gap-2 mb-4 rounded-xl bg-[#11122D] p-1 border border-white/10">
             <button
               onClick={() => {
                 setMode("signin");
                 resetMessage();
               }}
               className={`rounded-lg py-2 text-sm font-black uppercase tracking-wider transition ${mode === "signin" ? "bg-cyan-600 text-white" : "text-slate-400 hover:text-white"}`}
             >
               {AUTH_EN.signIn}
             </button>
             <button
               onClick={() => {
                 setMode("signup");
                 resetMessage();
               }}
               className={`rounded-lg py-2 text-sm font-black uppercase tracking-wider transition ${mode === "signup" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}
             >
               {AUTH_EN.signUp}
             </button>
           </div>

           <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
             <input 
               type="text" 
               placeholder={AUTH_EN.idNickname}
               value={nickname}
               onChange={(event) => {
                 setNickname(event.target.value);
                 resetMessage();
               }}
               className="w-full bg-[#11122D] border border-white/10 rounded-xl p-4 text-white font-bold outline-none focus:border-cyan-500 transition placeholder:text-slate-500"
             />
             <input 
               type="password" 
               placeholder={AUTH_EN.password}
               value={password}
               onChange={(event) => {
                 setPassword(event.target.value);
                 resetMessage();
               }}
               className="w-full bg-[#11122D] border border-white/10 rounded-xl p-4 text-white font-bold outline-none focus:border-cyan-500 transition placeholder:text-slate-500"
             />

             {mode === "signup" && (
               <input 
                 type="password" 
                 placeholder={AUTH_EN.confirmPassword}
                 value={confirmPassword}
                 onChange={(event) => {
                   setConfirmPassword(event.target.value);
                   resetMessage();
                 }}
                 className="w-full bg-[#11122D] border border-white/10 rounded-xl p-4 text-white font-bold outline-none focus:border-cyan-500 transition placeholder:text-slate-500"
               />
             )}

             {errorMessage && (
               <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">
                 {errorMessage}
               </p>
             )}

             <button
               type="submit"
               className={`w-full text-white font-black py-4 rounded-xl flex items-center justify-center gap-2 transition shadow-[0_4px_0_#1E40AF] hover:translate-y-1 hover:shadow-none active:translate-y-1 text-sm md:text-base ${mode === "signin" ? "bg-cyan-600 hover:bg-cyan-500" : "bg-indigo-600 hover:bg-indigo-500"}`}
             >
               {mode === "signin" ? <LogIn className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
               {mode === "signin" ? AUTH_EN.signIn : AUTH_EN.createAccount}
             </button>
           </form>

           <div className="w-full flex items-center gap-4 my-8 opacity-50">
             <div className="h-[1px] bg-white flex-1"></div>
             <span className="text-white font-black text-xs uppercase tracking-widest">{t("OR")}</span>
             <div className="h-[1px] bg-white flex-1"></div>
           </div>

           <button
             onClick={handleGuestLogin}
             className="w-full bg-transparent text-slate-300 border-2 border-slate-600 font-black py-4 rounded-xl hover:bg-slate-800 hover:text-white hover:border-slate-500 transition flex items-center justify-center gap-3 group"
           >
             <Users className="w-6 h-6 text-slate-400 group-hover:text-white transition" />
             {t("Play as Guest")}
           </button>
        </motion.div>
        
          <footer className="absolute bottom-6 text-xs font-bold text-slate-500 tracking-wider">
            AIPOT • AI Poker Trainer
        </footer>
     </div>
  );
}
