import { useNavigate } from "react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, ShoppingBag, Coins, Crown, Check, Zap } from "lucide-react";
import { motion } from "motion/react";
import { apiFetch } from "../api";
import { getCurrentAuth, patchSessionUser } from "../auth";
import { useI18n } from "../i18n";

type ChipPackageId = "chips-50k" | "chips-150k" | "chips-500k" | "chips-2000k";

interface ChipsPurchaseResponse {
  success: boolean;
  packageId: ChipPackageId;
  addedAmount: number;
  priceLabel: string;
  balanceAmount: number;
  role: "guest" | "free" | "pro";
  subscriptionActive: boolean;
}

interface ProSubscribeResponse {
  success: boolean;
  alreadySubscribed: boolean;
  plan: "monthly";
  role: "guest" | "free" | "pro";
  subscriptionActive: boolean;
  balanceAmount: number;
}

interface CheckoutState {
  kind: "chips" | "pro";
  title: string;
  priceLabel: string;
  packageId?: ChipPackageId;
  chipsAmount?: number;
}

interface CardForm {
  holderName: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
}

const CHIP_PACKAGES: Array<{
  id: number;
  packageId: ChipPackageId;
  amountLabel: string;
  chipsAmount: number;
  price: string;
  bonus: string | null;
  color: string;
}> = [
  { id: 1, packageId: "chips-50k", amountLabel: "50,000", chipsAmount: 50_000, price: "$4.99", bonus: null, color: "from-blue-600 to-blue-500" },
  { id: 2, packageId: "chips-150k", amountLabel: "150,000", chipsAmount: 150_000, price: "$9.99", bonus: "POPULAR", color: "from-cyan-600 to-cyan-500" },
  { id: 3, packageId: "chips-500k", amountLabel: "500,000", chipsAmount: 500_000, price: "$19.99", bonus: "BEST VALUE", color: "from-green-600 to-emerald-500" },
  { id: 4, packageId: "chips-2000k", amountLabel: "2,000,000", chipsAmount: 2_000_000, price: "$49.99", bonus: "WHALE", color: "from-orange-600 to-red-500" },
];

export function Store() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { isLoggedIn, isPro, balanceAmount } = getCurrentAuth();

  const [walletBalance, setWalletBalance] = useState(balanceAmount);
  const [proActive, setProActive] = useState(isPro);
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [cardForm, setCardForm] = useState<CardForm>({
    holderName: "",
    cardNumber: "",
    expiry: "",
    cvc: "",
  });

  const canPurchase = useMemo(() => isLoggedIn, [isLoggedIn]);

  const resetCheckout = () => {
    setCheckout(null);
    setBusy(false);
    setCardForm({
      holderName: "",
      cardNumber: "",
      expiry: "",
      cvc: "",
    });
  };

  const updateCardField = (key: keyof CardForm, value: string) => {
    setCardForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const normalizeDigits = (value: string) => value.replace(/\D/g, "");

  const validateCheckoutForm = () => {
    const cardDigits = normalizeDigits(cardForm.cardNumber);
    const expiryDigits = normalizeDigits(cardForm.expiry);
    const cvcDigits = normalizeDigits(cardForm.cvc);

    if (!cardForm.holderName.trim()) {
      alert(t("Enter card holder name."));
      return false;
    }
    if (cardDigits.length < 16) {
      alert(t("Enter a 16-digit card number."));
      return false;
    }
    if (expiryDigits.length < 4) {
      alert(t("Enter expiry date (MM/YY)."));
      return false;
    }
    if (cvcDigits.length < 3) {
      alert(t("Enter 3-digit CVC."));
      return false;
    }

    return true;
  };

  const openChipsCheckout = (pkg: (typeof CHIP_PACKAGES)[number]) => {
    if (!canPurchase) {
      alert(t("You must be signed in to purchase."));
      return;
    }
    setCheckout({
      kind: "chips",
      title: `${pkg.amountLabel} ${t("Chips")}`,
      priceLabel: pkg.price,
      packageId: pkg.packageId,
      chipsAmount: pkg.chipsAmount,
    });
    setNotice("");
  };

  const openProCheckout = () => {
    if (!canPurchase) {
      alert(t("You must be signed in to subscribe."));
      return;
    }
    if (proActive) {
      setNotice(t("PRO is already active."));
      return;
    }
    setCheckout({
      kind: "pro",
      title: "PRO Monthly Subscription",
      priceLabel: "$9.99 / month",
    });
    setNotice("");
  };

  const submitCheckout = async () => {
    if (!checkout || busy) return;
    if (!validateCheckoutForm()) return;

    setBusy(true);
    try {
      if (checkout.kind === "chips") {
        const response = await apiFetch<ChipsPurchaseResponse>("/profile/store/chips", {
          method: "POST",
          body: JSON.stringify({ packageId: checkout.packageId }),
        });

        setWalletBalance(response.balanceAmount);
        patchSessionUser({
          balanceAmount: response.balanceAmount,
          role: response.role,
        });

        setNotice(
          t("Payment completed: +{chips} chips", {
            chips: response.addedAmount.toLocaleString(),
          }),
        );
      } else {
        const response = await apiFetch<ProSubscribeResponse>("/profile/store/subscribe-pro", {
          method: "POST",
          body: JSON.stringify({ plan: "monthly" }),
        });

        setProActive(response.role === "pro" && response.subscriptionActive);
        setWalletBalance(response.balanceAmount);
        patchSessionUser({
          role: response.role,
          balanceAmount: response.balanceAmount,
        });

        setNotice(
          response.alreadySubscribed
            ? t("PRO is already active.")
            : t("PRO subscription has been activated."),
        );
      }

      resetCheckout();
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Payment failed."));
      setBusy(false);
    }
  };

  return (
    <div className="relative w-full h-full bg-[#11122D] flex flex-col font-sans select-none overflow-y-auto text-white no-scrollbar">
      {/* Top Header */}
      <header className="sticky top-0 flex items-center justify-between p-4 bg-[#1A1C3E] border-b border-white/5 z-20 shadow-md">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate("/lobby")}
            className="flex items-center gap-2 text-slate-300 hover:text-white transition"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-bold">{t("Lobby")}</span>
          </button>
          <div className="h-6 w-[1px] bg-white/10"></div>
          <h1 className="text-lg font-black tracking-wider uppercase flex items-center gap-2">
            <ShoppingBag className="text-yellow-400 w-5 h-5" />
            {t("Store")}
          </h1>
        </div>
        
        <div className="flex items-center bg-gradient-to-r from-yellow-600 to-yellow-500 rounded-full pr-4 pl-3 py-1.5 shadow-lg border border-yellow-400">
           <Coins className="w-4 h-4 text-white mr-2" />
            <span className="font-black text-white text-sm">${walletBalance.toLocaleString()}</span>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 p-6 lg:p-10 max-w-6xl mx-auto w-full">
        
        {/* Banner Section */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="w-full bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 rounded-2xl p-8 shadow-2xl border border-white/10 relative overflow-hidden mb-10 group"
        >
           <div className="absolute -right-20 -top-20 w-64 h-64 bg-white/20 rounded-full blur-3xl group-hover:scale-110 transition-transform"></div>
           
           <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 bg-yellow-400 text-indigo-900 text-xs font-black uppercase px-3 py-1 rounded-full w-max mb-3 tracking-widest">
                  <Crown className="w-3 h-3" /> {t("Monthly Pass")}
                </div>
                <h2 className="text-3xl md:text-5xl font-black mb-2 leading-tight">{t("PRO BUNDLE")}</h2>
                <p className="text-indigo-100 font-bold max-w-md">
                  {t("Unlock unlimited Hand Reviews, 2x daily chips, and completely ad-free experience.")}
                </p>
                <div className="flex gap-4 mt-6">
                   <div className="flex items-center gap-2 text-sm font-semibold"><Check className="w-4 h-4 text-yellow-400" /> {t("Infinite Reviews")}</div>
                   <div className="flex items-center gap-2 text-sm font-semibold"><Check className="w-4 h-4 text-yellow-400" /> {t("AI Coach Pro")}</div>
                </div>
              </div>

              <div className="flex flex-col items-center bg-black/40 p-6 rounded-xl border border-white/10 backdrop-blur-md shrink-0">
                 <div className="text-center mb-4">
                   <span className="text-3xl font-black text-white">$9.99</span>
                   <span className="text-slate-300 font-semibold">/mo</span>
                 </div>
                 <button
                   onClick={openProCheckout}
                   disabled={!canPurchase || proActive}
                   className="bg-white text-indigo-900 font-black px-8 py-3 rounded-full hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors uppercase tracking-wider shadow-lg"
                 >
                   {proActive ? t("PRO Active") : t("Subscribe Now")}
                 </button>
              </div>
           </div>
        </motion.div>

        {/* Chips Section */}
        <div className="mb-10">
          <h3 className="text-xl font-black uppercase tracking-wider mb-6 flex items-center gap-2">
            <Coins className="text-yellow-400" />
            {t("Buy Chips")}
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
             
             {CHIP_PACKAGES.map((pkg, i) => (
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  key={pkg.id} 
                  className={`relative flex flex-col items-center justify-between p-6 bg-gradient-to-b ${pkg.color} rounded-2xl shadow-xl border-2 border-white/10 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)] transition-all cursor-pointer group`}
                >
                   {pkg.bonus && (
                     <div className="absolute -top-3 bg-yellow-400 text-black text-[10px] font-black px-3 py-1 rounded-full uppercase shadow-md z-10">
                       {pkg.bonus}
                     </div>
                   )}
                   
                   <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 rounded-2xl mix-blend-overlay"></div>
                   
                   <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mb-4 border-[4px] border-white/30 shadow-[inset_0_0_20px_rgba(0,0,0,0.2)] group-hover:scale-110 transition-transform z-10">
                     <Coins className="w-10 h-10 text-yellow-300 drop-shadow-md" />
                   </div>
                   
                   <h4 className="text-2xl font-black drop-shadow-md z-10 mb-6">{pkg.amountLabel}</h4>
                   
                   <button
                     onClick={() => openChipsCheckout(pkg)}
                     disabled={!canPurchase}
                     className="w-full bg-white text-slate-900 font-black py-3 rounded-xl shadow-md group-hover:bg-slate-100 z-10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                   >
                     {pkg.price}
                   </button>
                </motion.div>
             ))}
          </div>
        </div>

        {notice && (
          <div className="mb-6 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-emerald-300 font-bold">
            {notice}
          </div>
        )}

        {!isLoggedIn && (
          <div className="mb-8 rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-yellow-300 font-bold">
            {t("Virtual payments are available only for signed-in accounts.")}
          </div>
        )}

      </div>

      {checkout && (
        <div className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1A1C3E] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-black text-white">{t("Virtual Payment")}</h2>
              <button
                onClick={resetCheckout}
                className="text-slate-400 hover:text-white font-bold"
                disabled={busy}
              >
                {t("Close")}
              </button>
            </div>

            <div className="rounded-xl bg-[#11122D] border border-white/10 p-4 mb-4">
              <p className="text-slate-300 text-sm font-bold uppercase tracking-wider">{t("Item")}</p>
              <p className="text-white font-black text-lg">{checkout.title}</p>
              <p className="text-cyan-300 font-bold mt-1">{checkout.priceLabel}</p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <input
                value={cardForm.holderName}
                onChange={(event) => updateCardField("holderName", event.target.value)}
                placeholder={t("Card Holder Name")}
                className="bg-[#11122D] border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-cyan-400"
              />
              <input
                value={cardForm.cardNumber}
                onChange={(event) => updateCardField("cardNumber", event.target.value)}
                placeholder={t("Card Number (16 digits)")}
                className="bg-[#11122D] border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-cyan-400"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={cardForm.expiry}
                  onChange={(event) => updateCardField("expiry", event.target.value)}
                  placeholder={t("MM/YY")}
                  className="bg-[#11122D] border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-cyan-400"
                />
                <input
                  value={cardForm.cvc}
                  onChange={(event) => updateCardField("cvc", event.target.value)}
                  placeholder={t("CVC")}
                  className="bg-[#11122D] border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-cyan-400"
                />
              </div>
            </div>

            <button
              onClick={() => {
                void submitCheckout();
              }}
              disabled={busy}
              className="mt-5 w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black py-3 rounded-xl"
            >
              {busy ? t("Processing...") : t("Pay Now")}
            </button>

            <p className="mt-3 text-xs text-slate-400 text-center">
              {t("This is a virtual payment flow for in-game economy testing.")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
