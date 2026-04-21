import React, { useState, useEffect, useRef } from "react";
import {
  Plus, ShieldCheck, User as UserIcon, Loader2, CheckCircle2,
  AlertCircle, Activity, Utensils, Home, Gift, Zap, Tag,
  MessageSquare, X, Send, BotMessageSquare, ShieldAlert,
  ArrowUpRight, ArrowDownLeft, Wallet, ChevronDown, Pencil,
  Sparkles, TrendingUp, TrendingDown, RefreshCw, Users, Scissors,
  Check, Receipt
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CATEGORIES = [
  { id: "food",    name: "Comida",     icon: Utensils, color: "text-orange-500", bg: "bg-orange-50",  pill: "bg-orange-100 text-orange-700" },
  { id: "rent",    name: "Arriendo",   icon: Home,     color: "text-blue-500",   bg: "bg-blue-50",    pill: "bg-blue-100 text-blue-700" },
  { id: "gift",    name: "Regalo",     icon: Gift,     color: "text-pink-500",   bg: "bg-pink-50",    pill: "bg-pink-100 text-pink-700" },
  { id: "utility", name: "Servicios",  icon: Zap,      color: "text-amber-500",  bg: "bg-amber-50",   pill: "bg-amber-100 text-amber-700" },
  { id: "other",   name: "Otro",       icon: Tag,      color: "text-slate-500",  bg: "bg-slate-50",   pill: "bg-slate-100 text-slate-600" },
];

interface User {
  id: string; name: string; email: string;
  account_id: string; balance: number; trust_limit: number;
  profile_picture?: string; bio?: string;
}

interface LedgerEntry {
  id: string; transaction_id: string;
  entry_type: "DEBIT" | "CREDIT";
  amount: number; balance_after: number;
  transaction_type: string; status: string;
  metadata: string; created_at: string;
  counterparty_name: string | null;
}

// ─── AI Assistant ─────────────────────────────────────────────────────────────

interface ChatMessage { role: "user" | "assistant"; content: string; }

const QUICK_PROMPTS = ["¿Cómo cargo saldo?", "¿Qué es HabiTrust™?", "¿Cómo divido una cuenta?"];

function HabiAssist() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: "assistant",
    content: "¡Hola! Soy HabiAssist 👋 Te guío en cualquier trámite dentro de HabiCapital. No veo tus datos — solo te oriento.",
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next); setInput(""); setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.reply || data.error }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "No estoy disponible ahora. Intenta de nuevo." }]);
    } finally { setLoading(false); }
  };

  return (
    <>
      <motion.button onClick={() => setOpen(v => !v)} whileHover={{ scale: 1.07 }} whileTap={{ scale: 0.95 }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-full shadow-2xl shadow-violet-500/30 flex items-center justify-center">
        <AnimatePresence mode="wait">
          {open
            ? <motion.div key="c" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}><X className="w-6 h-6" /></motion.div>
            : <motion.div key="o" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}><BotMessageSquare className="w-6 h-6" /></motion.div>}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }} transition={{ type: "spring", damping: 24, stiffness: 300 }}
            className="fixed bottom-24 right-6 z-50 w-[360px] bg-white rounded-3xl shadow-2xl shadow-slate-200 border border-slate-100 flex flex-col overflow-hidden" style={{ maxHeight: "520px" }}>
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-white/20 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div><p className="text-sm font-bold text-white">HabiAssist IA</p>
                <p className="text-[10px] text-violet-200">Solo orienta · No ejecuta acciones</p></div>
              <div className="ml-auto flex items-center gap-1.5 bg-white/15 rounded-full px-2.5 py-1">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[9px] text-white font-semibold">En línea</span>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-100">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <p className="text-[10px] text-amber-700">No tiene acceso a tu saldo ni historial.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/60">
              {messages.map((m, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                    m.role === "user" ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-tr-sm"
                      : "bg-white text-slate-700 border border-slate-100 rounded-tl-sm shadow-sm")}>
                    {m.content}
                  </div>
                </motion.div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-100 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm">
                    <div className="flex gap-1.5">
                      {[0, 150, 300].map(d => (
                        <div key={d} className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            {messages.length <= 1 && (
              <div className="px-4 py-2 flex flex-wrap gap-2 bg-white border-t border-slate-100">
                {QUICK_PROMPTS.map(q => (
                  <button key={q} onClick={() => send(q)}
                    className="text-[10px] font-semibold px-3 py-1.5 rounded-full bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors border border-violet-100">
                    {q}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={e => { e.preventDefault(); send(input); }}
              className="flex items-center gap-2 px-4 py-3 bg-white border-t border-slate-100">
              <input value={input} onChange={e => setInput(e.target.value)} placeholder="Escribe tu pregunta..."
                className="flex-1 bg-slate-50 rounded-xl px-4 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-violet-200 placeholder:text-slate-300 transition-all" />
              <button type="submit" disabled={!input.trim() || loading}
                className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center disabled:opacity-30 hover:opacity-90 transition-opacity flex-shrink-0">
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");

  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editBio, setEditBio] = useState("");
  const [editPic, setEditPic] = useState("");
  const [updatingProfile, setUpdatingProfile] = useState(false);

  const [targetUserId, setTargetUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("other");

  // Split bill state
  const [showSplit, setShowSplit] = useState(false);
  const [splitTotal, setSplitTotal] = useState("");
  const [splitDesc, setSplitDesc] = useState("");
  const [splitParticipants, setSplitParticipants] = useState<string[]>([]);
  const [splitting, setSplitting] = useState(false);
  const [splitDone, setSplitDone] = useState<{name: string, amount: number}[] | null>(null);

  useEffect(() => {
    if (currentUser) { setEditBio(currentUser.bio || ""); setEditPic(currentUser.profile_picture || ""); }
  }, [currentUser]);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      setUsers(data);
      if (!currentUser && data.length > 0) setCurrentUser(data[0]);
      else if (currentUser) {
        const updated = data.find((u: User) => u.id === currentUser.id);
        if (updated) setCurrentUser(updated);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const fetchLedger = async (accountId: string) => {
    try {
      const res = await fetch(`/api/ledger/${accountId}`);
      setLedger(await res.json());
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchData(); }, []);
  useEffect(() => { if (currentUser) fetchLedger(currentUser.account_id); }, [currentUser]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName || !newUserEmail) return;
    try {
      const res = await fetch("/api/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": `user_${Date.now()}` },
        body: JSON.stringify({ name: newUserName, email: newUserEmail }),
      });
      if (res.ok) { setNewUserName(""); setNewUserEmail(""); setShowCreateUser(false); await fetchData(); }
    } catch (e) { console.error(e); }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setUpdatingProfile(true);
    try {
      const res = await fetch(`/api/users/${currentUser.id}/profile`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio: editBio, profilePicture: editPic }),
      });
      if (res.ok) { setShowEditProfile(false); await fetchData(); }
    } catch (err) { console.error(err); }
    finally { setUpdatingProfile(false); }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { const r = new FileReader(); r.onloadend = () => setEditPic(r.result as string); r.readAsDataURL(file); }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !targetUserId || !amount) return;
    setTransferring(true); setError(null);
    const idempotencyKey = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    try {
      const targetUser = users.find(u => u.id === targetUserId);
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ fromAccountId: currentUser.account_id, toAccountId: targetUser?.account_id, amount: parseInt(amount) * 100, description, category: selectedCategory }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transferencia fallida");
      setAmount(""); setDescription(""); setTargetUserId(""); setSelectedCategory("other");
      await fetchData();
    } catch (err: any) { setError(err.message); }
    finally { setTransferring(false); }
  };

  const handleTopup = async () => {
    if (!currentUser) return;
    await fetch("/api/topup", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": `top_${Date.now()}` },
      body: JSON.stringify({ accountId: currentUser.account_id, amount: 500000 }),
    });
    fetchData();
  };

  const handleSplitBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !splitTotal || splitParticipants.length === 0) return;
    setSplitting(true);
    const total = Math.round(parseFloat(splitTotal) * 100);
    const perPerson = Math.floor(total / (splitParticipants.length + 1));
    const results: {name: string, amount: number}[] = [];
    for (const uid of splitParticipants) {
      const participant = users.find(u => u.id === uid);
      if (!participant) continue;
      try {
        const res = await fetch("/api/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Idempotency-Key": `split_${Date.now()}_${uid}` },
          body: JSON.stringify({
            fromAccountId: participant.account_id,
            toAccountId: currentUser.account_id,
            amount: perPerson,
            description: splitDesc || "División de cuenta",
            category: selectedCategory,
          }),
        });
        if (res.ok) results.push({ name: participant.name.split(" ")[0], amount: perPerson });
      } catch { /* individual failures don't block others */ }
    }
    setSplitDone(results);
    setSplitting(false);
    await fetchData();
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(amount / 100);

  const totalSent     = ledger.filter(e => e.entry_type === "DEBIT").reduce((s, e) => s + e.amount, 0);
  const totalReceived = ledger.filter(e => e.entry_type === "CREDIT" && e.transaction_type !== "topup").reduce((s, e) => s + e.amount, 0);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-violet-50 to-indigo-50">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-4 shadow-xl shadow-violet-200 animate-pulse">
          <Wallet className="w-8 h-8 text-white" />
        </div>
        <p className="text-slate-500 font-medium">Cargando tu billetera...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-violet-50/30 to-indigo-50/20 font-sans antialiased">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-3.5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-md shadow-violet-200">
            <ShieldCheck className="w-4.5 h-4.5 text-white w-[18px] h-[18px]" />
          </div>
          <span className="text-lg font-black tracking-tight">
            habi<span className="text-violet-600">capital</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => setShowCreateUser(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-700 text-sm font-semibold transition-colors">
            <Plus className="w-3.5 h-3.5" /> Nueva cuenta
          </button>
          <div className="relative">
            <select value={currentUser?.id}
              onChange={e => { const u = users.find(u => u.id === e.target.value); if (u) setCurrentUser(u); }}
              className="appearance-none pl-3 pr-8 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-violet-200 cursor-pointer">
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </header>

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <main className="max-w-[1400px] mx-auto px-6 py-8 grid grid-cols-12 gap-6">

        {/* ── LEFT COLUMN: Balance + Stats + Profile ─────────────────────── */}
        <aside className="col-span-12 lg:col-span-4 xl:col-span-3 flex flex-col gap-5">

          {/* Balance hero card */}
          <div className="relative rounded-3xl bg-gradient-to-br from-violet-600 via-violet-700 to-indigo-700 p-6 text-white overflow-hidden shadow-xl shadow-violet-200">
            {/* decorative circles */}
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/5" />
            <div className="absolute -bottom-6 -left-6 w-32 h-32 rounded-full bg-indigo-800/30" />

            <div className="relative">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-11 h-11 rounded-2xl bg-white/20 overflow-hidden flex items-center justify-center">
                  {currentUser?.profile_picture
                    ? <img src={currentUser.profile_picture} className="w-full h-full object-cover" alt="" />
                    : <span className="text-lg font-black">{currentUser?.name.charAt(0)}</span>}
                </div>
                <div>
                  <p className="text-xs text-violet-200 font-medium">Saldo disponible</p>
                  <p className="font-bold text-sm leading-tight">{currentUser?.name.split(" ")[0]}</p>
                </div>
                <button onClick={() => setShowEditProfile(true)} className="ml-auto p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>

              <motion.p key={currentUser?.balance} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                className="text-4xl font-black tracking-tight mb-1">
                {formatCurrency(currentUser?.balance ?? 0)}
              </motion.p>

              {(currentUser?.trust_limit ?? 0) > 0 && (
                <p className="text-xs text-violet-200 mb-5">
                  + {formatCurrency(currentUser!.trust_limit)} crédito HabiTrust™
                </p>
              )}

              <div className="grid grid-cols-3 gap-2 mt-5">
                <button onClick={handleTopup}
                  className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-white/15 hover:bg-white/25 text-xs font-semibold transition-colors active:scale-95">
                  <ArrowDownLeft className="w-4 h-4" /> Recargar
                </button>
                <button onClick={() => document.getElementById("transfer-form")?.scrollIntoView({ behavior: "smooth" })}
                  className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-white text-violet-700 hover:bg-violet-50 text-xs font-bold transition-colors active:scale-95 shadow-sm">
                  <ArrowUpRight className="w-4 h-4" /> Enviar
                </button>
                <button onClick={() => { setSplitDone(null); setSplitParticipants([]); setSplitTotal(""); setSplitDesc(""); setShowSplit(true); }}
                  className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-white/15 hover:bg-white/25 text-xs font-semibold transition-colors active:scale-95">
                  <Scissors className="w-4 h-4" /> Dividir
                </button>
              </div>
            </div>
          </div>

          {/* Mini stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center mb-2">
                <TrendingDown className="w-4 h-4 text-rose-500" />
              </div>
              <p className="text-xs text-slate-400 font-medium">Enviado</p>
              <p className="font-bold text-slate-800 text-sm mt-0.5">{formatCurrency(totalSent)}</p>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-xs text-slate-400 font-medium">Recibido</p>
              <p className="font-bold text-slate-800 text-sm mt-0.5">{formatCurrency(totalReceived)}</p>
            </div>
          </div>

          {/* HabiTrust card */}
          {(currentUser?.trust_limit ?? 0) > 0 && (
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                </div>
                <p className="font-bold text-sm text-slate-800">HabiTrust™</p>
              </div>
              <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                Línea de crédito social para liquidar gastos grupales, incluso si tu saldo está en cero.
              </p>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: "45%" }}
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" />
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-slate-400">Disponible</span>
                <span className="text-[10px] font-bold text-violet-600">{formatCurrency(currentUser?.trust_limit ?? 0)}</span>
              </div>
            </div>
          )}

          {/* Contacts */}
          <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                <p className="text-sm font-semibold text-slate-700">Contactos</p>
              </div>
              <button onClick={() => setShowCreateUser(true)}
                className="p-1 rounded-lg hover:bg-slate-50 text-slate-400 hover:text-violet-600 transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              {users.filter(u => u.id !== currentUser?.id).map(u => (
                <div key={u.id} className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-50 transition-colors group">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-400 to-indigo-400 flex items-center justify-center text-white text-sm font-bold overflow-hidden flex-shrink-0">
                    {u.profile_picture
                      ? <img src={u.profile_picture} className="w-full h-full object-cover" alt="" />
                      : u.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{u.name}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      setTargetUserId(u.id);
                      document.getElementById("transfer-form")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-600 text-xs font-semibold hover:bg-violet-100">
                    <ArrowUpRight className="w-3 h-3" /> Enviar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ── CENTER COLUMN: Movimientos ─────────────────────────────────── */}
        <section className="col-span-12 lg:col-span-8 xl:col-span-5 flex flex-col gap-5">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
            <div className="px-6 py-5 border-b border-slate-50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-800">Movimientos</h2>
                <p className="text-xs text-slate-400 mt-0.5">{ledger.length} transacciones · ledger doble entrada</p>
              </div>
              <button onClick={() => fetchLedger(currentUser!.account_id)}
                className="p-2 rounded-xl hover:bg-slate-50 text-slate-400 hover:text-violet-600 transition-colors">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto divide-y divide-slate-50">
              {ledger.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-300">
                  <Activity className="w-12 h-12 mb-3" />
                  <p className="font-medium text-slate-400">Sin movimientos aún</p>
                  <p className="text-sm">Haz una recarga o transferencia para empezar</p>
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {ledger.map((entry) => {
                    const isDebit = entry.entry_type === "DEBIT";
                    const isTopup = entry.transaction_type === "topup";
                    let metaObj = { memo: "", category: "other" };
                    try { metaObj = JSON.parse(entry.metadata); } catch {}
                    const cat = CATEGORIES.find(c => c.id === metaObj.category) || CATEGORIES[4];

                    return (
                      <motion.div key={entry.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50/70 transition-colors">
                        {/* Category icon */}
                        <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0", cat.bg)}>
                          <cat.icon className={cn("w-5 h-5", cat.color)} />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-slate-800 text-sm truncate">
                              {isTopup ? "Recarga" : isDebit ? `Para ${entry.counterparty_name ?? "—"}` : `De ${entry.counterparty_name ?? "—"}`}
                            </p>
                            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0",
                              isTopup ? "bg-emerald-50 text-emerald-600"
                                : isDebit ? "bg-rose-50 text-rose-500" : "bg-emerald-50 text-emerald-600")}>
                              {isTopup ? "CRÉDITO" : entry.entry_type}
                            </span>
                          </div>
                          {metaObj.memo && (
                            <p className="text-xs text-slate-400 truncate mt-0.5">{metaObj.memo}</p>
                          )}
                          <p className="text-[10px] text-slate-300 mt-0.5">
                            {new Date(entry.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>

                        {/* Amount */}
                        <div className="text-right flex-shrink-0">
                          <p className={cn("font-black text-base", isDebit ? "text-rose-500" : "text-emerald-600")}>
                            {isDebit ? "-" : "+"}{formatCurrency(entry.amount)}
                          </p>
                          <p className="text-[10px] text-slate-300">Saldo {formatCurrency(entry.balance_after)}</p>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </div>
        </section>

        {/* ── RIGHT COLUMN: Transfer Form ────────────────────────────────── */}
        <aside id="transfer-form" className="col-span-12 lg:col-span-12 xl:col-span-4 flex flex-col gap-5">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-50">
              <h2 className="text-lg font-black text-slate-800">Enviar dinero</h2>
              <p className="text-xs text-slate-400 mt-0.5">Transferencia instantánea e idempotente</p>
            </div>

            <form onSubmit={handleTransfer} className="px-6 py-5 space-y-5">
              {/* Contact picker */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">¿A quién?</label>
                <div className="grid grid-cols-3 gap-2">
                  {users.filter(u => u.id !== currentUser?.id).map(u => (
                    <button key={u.id} type="button" onClick={() => setTargetUserId(u.id)}
                      className={cn("flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all",
                        targetUserId === u.id
                          ? "bg-violet-50 border-violet-400 shadow-sm shadow-violet-100"
                          : "bg-slate-50 border-transparent hover:border-slate-200")}>
                      <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-sm font-black overflow-hidden",
                        targetUserId === u.id ? "bg-gradient-to-br from-violet-500 to-indigo-500 text-white" : "bg-white text-slate-600 border border-slate-200")}>
                        {u.profile_picture
                          ? <img src={u.profile_picture} className="w-full h-full object-cover" alt="" />
                          : u.name.charAt(0)}
                      </div>
                      <span className={cn("text-xs font-semibold truncate w-full text-center",
                        targetUserId === u.id ? "text-violet-700" : "text-slate-500")}>
                        {u.name.split(" ")[0]}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Monto (COP)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-300">$</span>
                  <input type="number" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0"
                    className="w-full pl-9 pr-4 py-4 text-3xl font-black text-slate-800 bg-slate-50 rounded-2xl outline-none focus:ring-2 focus:ring-violet-200 placeholder:text-slate-200 transition-all" />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Categoría</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map(cat => (
                    <button key={cat.id} type="button" onClick={() => setSelectedCategory(cat.id)}
                      className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                        selectedCategory === cat.id
                          ? "bg-slate-800 text-white border-slate-800"
                          : "bg-white text-slate-500 border-slate-200 hover:border-slate-300")}>
                      <cat.icon className="w-3 h-3" />{cat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Memo */}
              <input type="text" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Descripción (ej: Cena del viernes)"
                className="w-full px-4 py-3 text-sm bg-slate-50 rounded-2xl outline-none focus:ring-2 focus:ring-violet-200 placeholder:text-slate-300 transition-all" />

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex items-center gap-3 p-3 bg-rose-50 rounded-2xl border border-rose-100">
                    <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                    <p className="text-sm text-rose-600">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Submit */}
              <button type="submit" disabled={transferring || !targetUserId || !amount}
                className={cn("w-full py-4 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2",
                  transferring || !targetUserId || !amount
                    ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                    : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90 active:scale-[0.98] shadow-lg shadow-violet-200")}>
                {transferring ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowUpRight className="w-4 h-4" /> Enviar ahora</>}
              </button>

              <p className="text-center text-[10px] text-slate-300">Transferencia atómica · Ledger doble entrada</p>
            </form>
          </div>
        </aside>
      </main>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showCreateUser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowCreateUser(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 16 }}
              className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full relative z-10 border border-slate-100">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-5 shadow-lg shadow-violet-200">
                <UserIcon className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-black text-slate-800 mb-1">Nueva cuenta</h2>
              <p className="text-sm text-slate-400 mb-6">Registra un nuevo usuario en HabiCapital</p>
              <form onSubmit={handleCreateUser} className="space-y-4">
                <input type="text" required value={newUserName} onChange={e => setNewUserName(e.target.value)}
                  placeholder="Nombre completo" className="w-full bg-slate-50 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-violet-200 transition-all" />
                <input type="email" required value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)}
                  placeholder="Correo electrónico" className="w-full bg-slate-50 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-violet-200 transition-all" />
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowCreateUser(false)}
                    className="flex-1 py-3 rounded-xl bg-slate-50 text-slate-500 text-sm font-semibold hover:bg-slate-100 transition-colors">Cancelar</button>
                  <button type="submit"
                    className="flex-[2] py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold shadow-lg shadow-violet-200 hover:opacity-90 transition-opacity">
                    Crear cuenta
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showEditProfile && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowEditProfile(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 16 }}
              className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full relative z-10 border border-slate-100">
              <div className="text-center mb-6">
                <div className="w-20 h-20 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3 relative group cursor-pointer overflow-hidden border-2 border-dashed border-slate-200 hover:border-violet-400 transition-colors">
                  {editPic ? <img src={editPic} className="w-full h-full object-cover" alt="" /> : <Plus className="w-7 h-7 text-slate-300" />}
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
                <h2 className="text-xl font-black text-slate-800">Editar perfil</h2>
              </div>
              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <textarea maxLength={120} rows={3} value={editBio} onChange={e => setEditBio(e.target.value)}
                  placeholder="Bio corta (máx 120 caracteres)"
                  className="w-full bg-slate-50 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-violet-200 resize-none transition-all" />
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowEditProfile(false)}
                    className="flex-1 py-3 rounded-xl bg-slate-50 text-slate-500 text-sm font-semibold hover:bg-slate-100 transition-colors">Cancelar</button>
                  <button type="submit" disabled={updatingProfile}
                    className="flex-[2] py-3 rounded-xl bg-slate-800 text-white text-sm font-bold hover:bg-violet-600 transition-colors flex items-center justify-center gap-2">
                    {updatingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar cambios"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {/* ── Split Bill Modal ──────────────────────────────────────────── */}
        {showSplit && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 sm:p-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowSplit(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 32 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md relative z-10 border border-slate-100 overflow-hidden">

              {/* Header */}
              <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
                    <Receipt className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-white">Dividir cuenta</h2>
                    <p className="text-xs text-violet-200">Tú pagaste — los demás te devuelven su parte</p>
                  </div>
                  <button onClick={() => setShowSplit(false)} className="ml-auto p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {splitDone ? (
                /* ── Success state ── */
                <div className="p-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  </div>
                  <h3 className="text-lg font-black text-slate-800 mb-1">¡Cuenta dividida!</h3>
                  <p className="text-sm text-slate-400 mb-5">Se ejecutaron {splitDone.length} transferencias de forma automática</p>
                  <div className="space-y-2 mb-6">
                    {splitDone.map((r, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3 bg-emerald-50 rounded-2xl">
                        <div className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-emerald-500" />
                          <span className="text-sm font-semibold text-slate-700">{r.name} te pagó</span>
                        </div>
                        <span className="text-sm font-black text-emerald-600">{formatCurrency(r.amount)}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setShowSplit(false)}
                    className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-bold text-sm">
                    Listo
                  </button>
                </div>
              ) : (
                /* ── Form state ── */
                <form onSubmit={handleSplitBill} className="p-6 space-y-5">
                  {/* Total */}
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Total a dividir (COP)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-300">$</span>
                      <input type="number" required value={splitTotal} onChange={e => setSplitTotal(e.target.value)}
                        placeholder="0" min="1"
                        className="w-full pl-9 pr-4 py-4 text-3xl font-black text-slate-800 bg-slate-50 rounded-2xl outline-none focus:ring-2 focus:ring-violet-200 placeholder:text-slate-200" />
                    </div>
                  </div>

                  {/* Description */}
                  <input type="text" value={splitDesc} onChange={e => setSplitDesc(e.target.value)}
                    placeholder="¿Qué fue? (ej: Cena La Hamburguesería)"
                    className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-violet-200 placeholder:text-slate-300 transition-all" />

                  {/* Participants */}
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">¿Quiénes participaron?</label>
                    <div className="space-y-2">
                      {users.filter(u => u.id !== currentUser?.id).map(u => {
                        const selected = splitParticipants.includes(u.id);
                        return (
                          <button key={u.id} type="button"
                            onClick={() => setSplitParticipants(p => selected ? p.filter(id => id !== u.id) : [...p, u.id])}
                            className={cn("w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 transition-all text-left",
                              selected ? "bg-violet-50 border-violet-400" : "bg-slate-50 border-transparent hover:border-slate-200")}>
                            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-sm font-black overflow-hidden flex-shrink-0",
                              selected ? "bg-gradient-to-br from-violet-500 to-indigo-500 text-white" : "bg-white text-slate-600 border border-slate-200")}>
                              {u.profile_picture ? <img src={u.profile_picture} className="w-full h-full object-cover" alt="" /> : u.name.charAt(0)}
                            </div>
                            <span className={cn("text-sm font-semibold flex-1", selected ? "text-violet-700" : "text-slate-600")}>{u.name}</span>
                            {selected && <Check className="w-4 h-4 text-violet-500" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Live preview */}
                  {splitTotal && splitParticipants.length > 0 && (
                    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-violet-50 rounded-2xl p-4 border border-violet-100">
                      <p className="text-xs text-violet-500 font-semibold mb-2 uppercase tracking-wide">Resumen</p>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">{splitParticipants.length + 1} personas</span>
                        <span className="text-lg font-black text-violet-700">
                          {formatCurrency(Math.floor(parseFloat(splitTotal || "0") * 100 / (splitParticipants.length + 1)))} c/u
                        </span>
                      </div>
                      <p className="text-xs text-violet-400 mt-1">
                        {splitParticipants.map(id => users.find(u => u.id === id)?.name.split(" ")[0]).join(", ")} te transferirán su parte
                      </p>
                    </motion.div>
                  )}

                  <button type="submit" disabled={splitting || !splitTotal || splitParticipants.length === 0}
                    className={cn("w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all",
                      splitting || !splitTotal || splitParticipants.length === 0
                        ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                        : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90 shadow-lg shadow-violet-200 active:scale-[0.98]")}>
                    {splitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Scissors className="w-4 h-4" /> Cobrar mi parte</>}
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        )}

      </AnimatePresence>

      {/* ── Footer minimal ──────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 px-6 py-4 flex items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Sistema operativo</span>
          <span>Ledger doble entrada · ACID garantizado</span>
        </div>
        <a href="/api/audit/integrity" target="_blank" className="hover:text-violet-600 transition-colors underline underline-offset-2">Auditar ledger</a>
      </footer>

      <HabiAssist />
    </div>
  );
}
