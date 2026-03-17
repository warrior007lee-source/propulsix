import React, { useState, useEffect } from 'react';
import { 
  Rocket, 
  Settings, 
  AlertTriangle, 
  CheckCircle, 
  Flame,
  Wind,
  Lightbulb,
  ChevronRight,
  Activity,
  ArrowRight,
  MessageSquare,
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

// --- Types & Constants ---
type InjectorType = 'impinging' | 'coaxial' | 'swirl';

interface EngineInputs {
  // Propellant
  fuel: string;
  oxidizer: string;
  mr: number; // Mixture Ratio (O/F)
  T_fuel: number; // K
  T_ox: number; // K
  
  // Flow
  m_dot: number; // kg/s
  
  // Injector
  injector: InjectorType;
  delta_P: number; // % of Pc
  
  // Chamber
  Pc: number; // bar
  L: number; // m
  D: number; // m
  
  // Environment
  Pa: number; // bar
  eps: number; // Expansion ratio
  
  // Advanced
  aiMode: boolean;
}

const FUEL_PROPS: Record<string, { cStarBase: number; gamma: number; T_c_base: number; mw: number }> = {
  'RP-1': { cStarBase: 1750, gamma: 1.22, T_c_base: 3600, mw: 22 },
  'LH2': { cStarBase: 2350, gamma: 1.20, T_c_base: 3300, mw: 12 },
  'CH4': { cStarBase: 1850, gamma: 1.20, T_c_base: 3500, mw: 18 },
  'Ethanol': { cStarBase: 1700, gamma: 1.22, T_c_base: 3400, mw: 24 },
  'UDMH': { cStarBase: 1800, gamma: 1.21, T_c_base: 3500, mw: 20 },
  'MMH': { cStarBase: 1820, gamma: 1.21, T_c_base: 3550, mw: 19 },
  'Hydrazine': { cStarBase: 1850, gamma: 1.20, T_c_base: 3600, mw: 17 },
  'Custom': { cStarBase: 1750, gamma: 1.22, T_c_base: 3500, mw: 22 }
};

const OXIDIZERS = ['LOX', 'N2O4', 'H2O2', 'Nitric Acid', 'FLOX'];

const INJECTOR_PROPS: Record<InjectorType, { eff: number; risk: number }> = {
  'impinging': { eff: 0.95, risk: 2 },
  'coaxial': { eff: 0.97, risk: 1 },
  'swirl': { eff: 0.98, risk: 0 },
};

const ALTITUDES: Record<string, number> = {
  'Sea Level (0 km)': 1.01325,
  '10 km': 0.265,
  '20 km': 0.055,
  'Space (>100 km)': 0.0001,
};

// ==========================================
// 1. COMBUSTION MODULE
// ==========================================
function combustion_module(inputs: EngineInputs) {
  const { Pc, m_dot, fuel, mr, injector, delta_P, L, D, aiMode } = inputs;
  const props = FUEL_PROPS[fuel] || FUEL_PROPS['Custom'];
  const injProps = INJECTOR_PROPS[injector];

  // AI Mode Auto-Correction (Simulated)
  let effective_mr = mr;
  let effective_delta_P = delta_P;
  if (aiMode) {
    // AI optimizes MR slightly towards ideal and ensures safe pressure drop
    effective_mr = mr * 0.95 + 0.1; 
    if (effective_delta_P < 15) effective_delta_P = 20;
  }

  // Physics Calculations
  const L_D = L / D;
  const Pc_Pa = Pc * 100000;
  
  // 1. Combustion Temperature (Tc)
  // Simplified approximation based on fuel type and MR
  const Tc = props.T_c_base * (1 - Math.abs(effective_mr - 2.5) * 0.05);
  
  // 2. Combustion Efficiency (ηc)
  let eff = injProps.eff;
  if (L_D < 1.5) eff *= 0.9; // Poor mixing
  if (effective_delta_P < 10) eff *= 0.95; // Poor atomization
  
  // 3. Characteristic Velocity (c*)
  const cStar = props.cStarBase * eff;
  
  // 4. Throat Area (At) & Diameter (Dt)
  const At = (m_dot * cStar) / Pc_Pa;
  const Dt = Math.sqrt((4 * At) / Math.PI);
  
  // 5. Chamber Volume (Vc) & Characteristic Length (L*)
  const Ac = Math.PI * Math.pow(D / 2, 2);
  const Vc = Ac * L;
  const L_star = Vc / At; // meters
  
  // 6. Residence Time (t_res)
  // t_res = Vc / (m_dot / rho_c) -> simplified approximation
  const R_specific = 8314 / props.mw;
  const rho_c = Pc_Pa / (R_specific * Tc);
  const t_res = (Vc * rho_c) / m_dot; // seconds
  
  // 7. Specific Impulse (Isp) - Chamber theoretical
  const Isp = (cStar * 1.5) / 9.81; // Simplified thrust coefficient of 1.5
  
  // Stability Logic & Score
  let riskScore = 0;
  let explanation = "";
  
  // L* check
  if (L_star < 0.8) {
    riskScore += 3;
    explanation += "L* is too low, risking incomplete combustion. ";
  } else if (L_star > 3.0) {
    riskScore += 2;
    explanation += "L* is very high, increasing cooling requirements and weight. ";
  }
  
  // Delta P check
  if (effective_delta_P < 15) {
    riskScore += 4;
    explanation += "Injector ΔP is too low (<15%), high risk of chugging instability. ";
  }
  
  // L/D check
  if (L_D < 1.5) {
    riskScore += 3;
    explanation += "Low L/D ratio leads to insufficient mixing. ";
  } else if (L_D > 5) {
    riskScore += 3;
    explanation += "High L/D ratio increases risk of longitudinal acoustic instabilities. ";
  }
  
  if (Pc > 200) riskScore += 3;
  
  riskScore += injProps.risk;

  let stability = "Stable";
  if (riskScore >= 7) stability = "Unstable";
  else if (riskScore >= 4) stability = "Medium Risk";
  
  if (explanation === "") {
    explanation = "All parameters are within optimal ranges for stable combustion.";
  }

  // Performance Score (0-100)
  const perfScore = Math.max(0, Math.min(100, Math.round(eff * 100 - riskScore * 2)));

  return {
    MR: effective_mr,
    Tc,
    L_star,
    eff,
    delta_P: effective_delta_P,
    Isp,
    t_res: t_res * 1000, // ms
    cStar,
    At,
    Dt,
    L_D,
    stability,
    riskScore,
    perfScore,
    explanation
  };
}

export interface NozzleInputs {
  Pc: number;
  m_dot: number;
  Tc: number;
  At: number;
  eps: number;
  Pa: number;
}

// ==========================================
// 2. NOZZLE MODULE
// ==========================================
function nozzle_module(inputs: NozzleInputs) {
  const { Pc, m_dot, Tc, At, eps, Pa } = inputs;
  const gamma = 1.2; // Assuming average gamma for rocket exhaust
  const mw = 22; // Assuming average molecular weight
  const R = 8314 / mw;
  
  const Pc_Pa = Pc * 100000;
  const Pa_Pa = Pa * 100000;
  
  // 1. Exit Area
  const Ae = At * eps;
  
  // Helper: Solve for supersonic Mach number given expansion ratio (eps)
  let M = 3.0; // Initial guess for supersonic flow
  for (let i = 0; i < 20; i++) {
    const term1 = 2 / (gamma + 1);
    const term2 = 1 + ((gamma - 1) / 2) * M * M;
    const calcEps = (1 / M) * Math.pow(term1 * term2, (gamma + 1) / (2 * (gamma - 1)));
    const dEps_dM = calcEps * (M * M - 1) / (M * term2);
    M = M - (calcEps - eps) / dEps_dM;
    if (Math.abs(calcEps - eps) < 1e-5) break;
  }
  
  // 2. Exit Pressure (Pe)
  const Pe_Pa = Pc_Pa * Math.pow(1 + ((gamma - 1) / 2) * M * M, -gamma / (gamma - 1));
  const Pe = Pe_Pa / 100000;
  
  // 3. Exhaust Velocity (Ve)
  const Te = Tc / (1 + ((gamma - 1) / 2) * M * M); // Static exit temperature
  const Ve = M * Math.sqrt(gamma * R * Te);
  
  // 4. Thrust (F)
  const Thrust = m_dot * Ve + (Pe_Pa - Pa_Pa) * Ae;
  
  // 5. Specific Impulse (Isp)
  const Isp = Thrust / (m_dot * 9.81);
  
  // 6. Nozzle Efficiency (eta_n)
  let eta_n = 0.98; // Base for ideal
  
  // Flow Regime
  let condition = "Ideally expanded";
  let explanation = "Exit pressure matches ambient pressure closely. Plume is optimal.";
  const warnings: string[] = [];
  const pressureRatio = Pe_Pa / Pa_Pa;
  
  // Calculate Optimal Expansion Ratio for current altitude
  let optimalEps = eps;
  if (Pc_Pa > Pa_Pa) {
    const M_opt = Math.sqrt((2 / (gamma - 1)) * (Math.pow(Pc_Pa / Pa_Pa, (gamma - 1) / gamma) - 1));
    const term1_opt = 2 / (gamma + 1);
    const term2_opt = 1 + ((gamma - 1) / 2) * M_opt * M_opt;
    optimalEps = (1 / M_opt) * Math.pow(term1_opt * term2_opt, (gamma + 1) / (2 * (gamma - 1)));
  }
  
  if (pressureRatio > 1.05) {
    condition = "Under-expanded";
    explanation = "Exit pressure is higher than ambient. Plume expands outward after exit.";
    warnings.push("Energy is lost in the expanding plume outside the nozzle.");
    eta_n -= 0.02 * Math.min(pressureRatio - 1, 1); // Cap penalty
  } else if (pressureRatio < 0.95) {
    condition = "Over-expanded";
    explanation = "Exit pressure is lower than ambient pressure. Plume is compressed by atmosphere.";
    if (pressureRatio < 0.4) {
      warnings.push("CRITICAL: Severe over-expansion. High risk of flow separation and shock formation inside the nozzle!");
      eta_n -= 0.1;
    } else {
      warnings.push("Shock formation risk due to pressure mismatch.");
      eta_n -= 0.05;
    }
  }
  
  eta_n = Math.max(0, Math.min(1, eta_n));
  
  const perfScore = Math.max(0, Math.min(100, Math.round(eta_n * 100 - (warnings.length > 0 && warnings[0].includes('CRITICAL') ? 20 : 0))));

  return {
    At,
    Ae,
    eps,
    Pc,
    Pe,
    Pa,
    Thrust: Thrust / 1000, // kN
    Ve,
    Isp,
    eta_n,
    condition,
    explanation,
    warnings,
    optimalEps,
    perfScore
  };
}

// ==========================================
// 3. AI SUGGESTIONS MODULE
// ==========================================
function suggestion_engine(inputs: EngineInputs, comb: ReturnType<typeof combustion_module>, noz: ReturnType<typeof nozzle_module>) {
  const healthScore = Math.round((comb.perfScore + noz.perfScore) / 2);
  
  let combStatus = comb.perfScore > 85 ? "Optimal" : comb.perfScore > 60 ? "Moderate" : "Poor";
  let nozStatus = noz.condition === "Ideally expanded" ? "Ideal" : noz.condition;
  
  const issues: { severity: string, text: string }[] = [];
  const recommendations: string[] = [];
  
  // Combustion Issues
  if (comb.L_D < 1.5) {
    issues.push({ severity: '🔴 Critical', text: `Low L/D ratio (${comb.L_D.toFixed(2)}) leading to poor mixing and incomplete combustion.` });
    recommendations.push('Increase chamber length (L) or decrease diameter (D) to improve mixing.');
  } else if (comb.L_D < 2) {
    issues.push({ severity: '🟡 Moderate', text: `Sub-optimal L/D ratio (${comb.L_D.toFixed(2)}) may cause slight mixing inefficiencies.` });
    recommendations.push('Slightly increase chamber length (L).');
  } else if (comb.L_D > 5) {
    issues.push({ severity: '🟡 Moderate', text: `High L/D ratio (${comb.L_D.toFixed(2)}) increases risk of longitudinal acoustic instabilities.` });
    recommendations.push('Decrease chamber length (L) to mitigate wave effects.');
  }

  if (inputs.Pc > 200) {
    issues.push({ severity: '🟡 Moderate', text: 'Very high chamber pressure significantly increases high-frequency instability risk.' });
    recommendations.push('Consider lowering chamber pressure or using acoustic cavities/baffles.');
  }

  if (inputs.injector === 'impinging') {
    issues.push({ severity: '🟡 Moderate', text: 'Impinging injectors have a higher inherent risk of triggering combustion instabilities.' });
    recommendations.push("Optimize injector type (e.g., switch to 'swirl' or 'coaxial') for better stability.");
  }

  // Nozzle Issues
  if (noz.condition === "Under-expanded") {
    issues.push({ severity: '🟡 Moderate', text: `Under-expanded nozzle: Exit pressure (${noz.Pe.toFixed(2)} bar) > Ambient (${noz.Pa.toFixed(2)} bar). Energy is lost in the expanding plume.` });
    recommendations.push('Adjust expansion ratio (increase Ae/At) to match ambient pressure and extract more thrust.');
  } else if (noz.condition === "Over-expanded") {
    issues.push({ severity: '🔴 Critical', text: `Over-expanded nozzle: Exit pressure (${noz.Pe.toFixed(2)} bar) < Ambient (${noz.Pa.toFixed(2)} bar). Risk of flow separation and thrust loss.` });
    recommendations.push('Decrease expansion ratio or operate at a higher altitude to avoid efficiency loss and shock formation.');
  }

  if (issues.length === 0) {
    issues.push({ severity: '🟢 Optimal', text: 'All parameters are within optimal ranges for the current altitude.' });
    recommendations.push('Design is well-optimized. Proceed to detailed CFD or hot-fire testing.');
  }

  // Optimized Stats (rough estimation for demonstration)
  const opt_eff = Math.max(comb.eff, 0.98);
  const opt_Isp = comb.Isp * (opt_eff / comb.eff) * (noz.condition === 'Ideally expanded' ? 1.0 : 1.05);
  const opt_Thrust = noz.Thrust * (opt_eff / comb.eff) * (noz.condition === 'Ideally expanded' ? 1.0 : 1.05);

  const opt_eff_display = (opt_eff * 100).toFixed(1);
  const current_eff_display = (comb.eff * 100).toFixed(1);
  
  const thrust_increase = ((opt_Thrust - noz.Thrust) / noz.Thrust * 100).toFixed(1);

  return {
    currentState: {
      explanation: `The engine is currently operating under ${healthScore > 80 ? 'highly efficient' : healthScore > 60 ? 'moderate' : 'sub-optimal'} conditions. ${comb.eff < 0.9 ? 'Combustion efficiency is reduced due to mixing or atomization limits.' : 'Combustion is relatively stable and efficient.'} The nozzle is ${noz.condition.toLowerCase()}, ${noz.condition === 'Ideally expanded' ? 'maximizing thrust extraction.' : 'leading to potential thrust loss and flow separation risks.'}`,
      combustionStatus: combStatus,
      nozzleStatus: nozStatus,
      healthScore
    },
    issues,
    optimizedVersion: `An optimized configuration would include ${comb.L_D < 2 ? 'a higher chamber length-to-diameter ratio, ' : ''}${inputs.delta_P < 15 ? 'improved injector atomization (higher ΔP), ' : ''}${noz.condition !== 'Ideally expanded' ? 'and an adjusted expansion ratio to match ambient pressure conditions.' : 'maintaining the current expansion ratio while refining chamber geometry.'}`,
    comparison: {
      current: { thrust: noz.Thrust.toFixed(1), eff: current_eff_display, isp: noz.Isp.toFixed(1) },
      optimized: { thrust: `+${thrust_increase}% increase`, eff: `Improved (~${opt_eff_display}%)`, isp: `Increased to ~${opt_Isp.toFixed(1)} s` }
    },
    recommendations: recommendations,
    summary: `The engine shows ${healthScore > 80 ? 'excellent potential' : 'moderate inefficiencies'} due to ${issues.length > 0 ? 'identified geometric and flow parameters' : 'minor tolerances'}. Optimizing these can significantly enhance overall performance and stability.`
  };
}

// ==========================================
// TOOLTIP COMPONENT
// ==========================================
const Tooltip = ({ text }: { text: string }) => (
  <div className="relative group ml-1 inline-block">
    <Info className="w-3 h-3 text-slate-500 cursor-help" />
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-black/90 border border-white/20 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 normal-case tracking-normal">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-black/90"></div>
    </div>
  </div>
);

// ==========================================
// RESULT CARD COMPONENT
// ==========================================
const ResultCard = ({ 
  title, 
  value, 
  unit, 
  shortMeaning, 
  fullExplanation, 
  colorClass = "orange" 
}: { 
  title: string, 
  value: string | number, 
  unit: string, 
  shortMeaning: string, 
  fullExplanation: string, 
  colorClass?: "orange" | "sky" 
}) => {
  const [expanded, setExpanded] = useState(false);
  
  const colorMap = {
    orange: "from-orange-500/10",
    sky: "from-sky-500/10",
  };
  
  return (
    <div className="p-5 bg-white/5 border border-white/10 rounded-xl relative group transition-all duration-300 flex flex-col h-full">
      <div className={`absolute inset-0 bg-gradient-to-br ${colorMap[colorClass]} to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-xl`}></div>
      
      <div className="flex justify-between items-start mb-3 relative z-10">
        <div className="flex items-center text-xs text-slate-400 uppercase tracking-widest font-bold">
          {title}
        </div>
        <button 
          onClick={() => setExpanded(!expanded)} 
          className="text-slate-400 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
          title="Toggle Details"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>
      
      <div className="text-3xl font-mono text-white mb-3 relative z-10">
        {value} <span className="text-sm font-sans text-slate-500">{unit}</span>
      </div>
      
      <div className="text-sm text-slate-300 font-light leading-relaxed mb-4 relative z-10 flex-grow break-words">
        {shortMeaning}
      </div>
      
      {expanded && (
        <div className="mt-2 pt-4 border-t border-white/10 text-sm text-slate-300 font-light leading-relaxed relative z-10 animate-in fade-in slide-in-from-top-2 duration-300 break-words">
          <strong className="text-white font-medium block mb-2">Detailed Explanation:</strong>
          {fullExplanation}
        </div>
      )}
      
      <div className="mt-auto pt-3 relative z-10">
        <button 
          onClick={() => setExpanded(!expanded)} 
          className="text-[10px] text-slate-400 hover:text-white uppercase tracking-widest flex items-center gap-1 transition-colors font-bold"
        >
          {expanded ? <><ChevronUp className="w-3 h-3" /> Collapse</> : <><ChevronDown className="w-3 h-3" /> Expand</>}
        </button>
      </div>
    </div>
  );
};

// ==========================================
// MAIN UI COMPONENT
// ==========================================
export default function App() {
  const [inputs, setInputs] = useState<EngineInputs>({
    fuel: 'RP-1',
    oxidizer: 'LOX',
    mr: 2.56,
    T_fuel: 298,
    T_ox: 90,
    m_dot: 50,
    injector: 'coaxial',
    delta_P: 20,
    Pc: 100,
    L: 0.6,
    D: 0.4,
    Pa: 1.01325,
    eps: 16,
    aiMode: false
  });

  const [nozzleInputs, setNozzleInputs] = useState<NozzleInputs>({
    Pc: 100,
    m_dot: 50,
    Tc: 3500,
    At: 0.05,
    eps: 16,
    Pa: 1.01325,
  });

  const [combustionResults, setCombustionResults] = useState<ReturnType<typeof combustion_module> | null>(null);
  const [nozzleResults, setNozzleResults] = useState<ReturnType<typeof nozzle_module> | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<ReturnType<typeof suggestion_engine> | null>(null);

  // UI State
  const [exploredCombustion, setExploredCombustion] = useState(false);
  const [exploredNozzle, setExploredNozzle] = useState(false);
  const [exploredAI, setExploredAI] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  
  // Collapsible Sections State
  const [openSections, setOpenSections] = useState({
    propellant: true,
    flow: false,
    injector: false,
    geometry: false
  });

  const [openNozzleSections, setOpenNozzleSections] = useState({
    flow: true,
    geometry: false,
    environment: false
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleNozzleSection = (section: keyof typeof openNozzleSections) => {
    setOpenNozzleSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Feedback State
  const [feedbackName, setFeedbackName] = useState('');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [isFeedbackSubmitted, setIsFeedbackSubmitted] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    let parsedValue: any = value;
    if (type === 'checkbox') {
      parsedValue = (e.target as HTMLInputElement).checked;
    } else if (!['fuel', 'oxidizer', 'injector'].includes(name)) {
      parsedValue = parseFloat(value) || 0;
    }

    setInputs(prev => ({
      ...prev,
      [name]: parsedValue
    }));
    
    // Clear downstream results when inputs change
    setCombustionResults(null);
    setNozzleResults(null);
    setAiSuggestions(null);
  };

  const handleNozzleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNozzleInputs(prev => ({
      ...prev,
      [name]: parseFloat(value) || 0
    }));
    setNozzleResults(null);
    setAiSuggestions(null);
  };

  const handleComputeCombustion = () => {
    const results = combustion_module(inputs);
    setCombustionResults(results);
    setNozzleResults(null);
    setAiSuggestions(null);
    
    // Auto-update nozzle inputs with combustion results
    setNozzleInputs(prev => ({
      ...prev,
      Pc: inputs.Pc,
      m_dot: inputs.m_dot,
      Tc: results.Tc,
      At: results.At,
      Pa: inputs.Pa
    }));
  };

  const handleComputeNozzle = () => {
    const results = nozzle_module(nozzleInputs);
    setNozzleResults(results);
    
    if (combustionResults) {
      const suggestions = suggestion_engine(inputs, combustionResults, results);
      setAiSuggestions(suggestions);
    }
  };

  const handleFeedbackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;
    
    const newFeedback = { 
      name: feedbackName || 'Anonymous', 
      text: feedbackText, 
      rating: feedbackRating, 
      date: new Date().toISOString() 
    };
    
    // Store in local storage
    const existing = JSON.parse(localStorage.getItem('propulsix_feedback') || '[]');
    localStorage.setItem('propulsix_feedback', JSON.stringify([...existing, newFeedback]));
    
    setIsFeedbackSubmitted(true);
    setFeedbackName('');
    setFeedbackText('');
    setFeedbackRating(5);
    
    // Hide success message after 5 seconds
    setTimeout(() => setIsFeedbackSubmitted(false), 5000);
  };

  return (
    <div className="bg-black text-white font-sans selection:bg-sky-500/30">
      
      {/* Fixed Navbar */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${isScrolled ? 'bg-black/80 backdrop-blur-md border-b border-white/10 py-4' : 'bg-transparent py-6'}`}>
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex justify-between items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => scrollTo('hero')}>
            <Rocket className="w-6 h-6 text-white" />
            <span className="text-xl font-bold tracking-widest uppercase">PropulsiX</span>
          </div>
          <div className="hidden md:flex gap-8 text-xs font-semibold tracking-widest uppercase text-slate-300">
            <button onClick={() => scrollTo('hero')} className="hover:text-white transition-colors">About</button>
            <button onClick={() => scrollTo('combustion')} className="hover:text-white transition-colors">Combustion</button>
            <button onClick={() => scrollTo('nozzle')} className="hover:text-white transition-colors">Nozzle</button>
            <button onClick={() => scrollTo('ai')} className="hover:text-white transition-colors">Intelligence</button>
          </div>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section id="hero" className="relative h-screen flex items-center justify-start px-6 md:px-24 bg-cover bg-center bg-fixed" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?q=80&w=2072&auto=format&fit=crop)' }}>
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-transparent"></div>
        <div className="relative z-10 max-w-3xl space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-1000">
          <h1 className="text-6xl md:text-8xl font-bold text-white tracking-tighter uppercase leading-none">PropulsiX AI</h1>
          <p className="text-xl md:text-2xl text-slate-300 font-light tracking-wide">Next-Gen Rocket Engine Combustion & Nozzle Intelligence Platform</p>
          <p className="text-md text-slate-400 max-w-xl leading-relaxed">Design, analyze, and optimize rocket engines using physics-informed AI. Experience the future of aerospace engineering.</p>
          <div className="pt-8">
            <button 
              onClick={() => scrollTo('combustion')} 
              className="px-8 py-4 border border-white text-white hover:bg-white hover:text-black transition-all duration-300 tracking-widest uppercase text-sm font-semibold flex items-center gap-3"
            >
              Explore <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* SECTION 1: COMBUSTION MODULE */}
      <section id="combustion" className="relative min-h-screen flex items-center justify-center px-6 py-24 bg-cover bg-center bg-fixed" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1578598011245-2078696d36e2?q=80&w=2070&auto=format&fit=crop)' }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"></div>
        
        <div className="relative z-10 w-full max-w-6xl">
          {!exploredCombustion ? (
            <div className="text-center space-y-8 animate-in fade-in zoom-in-95 duration-700">
              <h2 className="text-5xl md:text-7xl font-bold text-white tracking-tighter uppercase">Combustion Analysis</h2>
              <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto font-light">Compute and analyze key combustion parameters to evaluate engine stability, efficiency, and mixing performance.</p>
              <button 
                onClick={() => setExploredCombustion(true)} 
                className="mt-8 px-8 py-4 border border-white text-white hover:bg-white hover:text-black transition-all duration-300 tracking-widest uppercase text-sm font-semibold inline-flex items-center gap-3"
              >
                Explore Combustion <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-8 md:p-12 shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="flex items-center gap-4 mb-8 border-b border-white/10 pb-6">
                <Flame className="w-8 h-8 text-orange-500" />
                <h2 className="text-3xl font-bold text-white tracking-tight uppercase">Combustion Module</h2>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Inputs Panel */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-widest">Input Parameters</h3>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <div className="relative">
                        <input type="checkbox" name="aiMode" checked={inputs.aiMode} onChange={handleInputChange} className="sr-only" />
                        <div className={`block w-10 h-6 rounded-full transition-colors ${inputs.aiMode ? 'bg-indigo-500' : 'bg-white/10'}`}></div>
                        <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${inputs.aiMode ? 'transform translate-x-4' : ''}`}></div>
                      </div>
                      <span className="text-xs font-bold tracking-widest uppercase text-indigo-300 flex items-center gap-1">
                        <Lightbulb className="w-3 h-3" /> AI Mode
                      </span>
                    </label>
                  </div>

                  {/* Propellant Section */}
                  <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                    <button onClick={() => toggleSection('propellant')} className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors">
                      <span className="text-xs font-bold tracking-widest uppercase text-slate-300">Propellant Parameters</span>
                      {openSections.propellant ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>
                    {openSections.propellant && (
                      <div className="p-4 grid grid-cols-2 gap-4 border-t border-white/5">
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Fuel Type <Tooltip text="Primary combustible material. Select or type custom." />
                          </label>
                          <input 
                            list="fuels-list" 
                            name="fuel" 
                            value={inputs.fuel} 
                            onChange={handleInputChange} 
                            placeholder="e.g. RP-1, LH2, Custom"
                            className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none" 
                          />
                          <datalist id="fuels-list">
                            {Object.keys(FUEL_PROPS).filter(f => f !== 'Custom').map(f => (
                              <option key={f} value={f} />
                            ))}
                          </datalist>
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Oxidizer <Tooltip text="Provides oxygen for combustion. Select or type custom." />
                          </label>
                          <input 
                            list="oxidizers-list" 
                            name="oxidizer" 
                            value={inputs.oxidizer} 
                            onChange={handleInputChange} 
                            placeholder="e.g. LOX, N2O4, Custom"
                            className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none" 
                          />
                          <datalist id="oxidizers-list">
                            {OXIDIZERS.map(ox => (
                              <option key={ox} value={ox} />
                            ))}
                          </datalist>
                        </div>
                        <div className="space-y-1 col-span-2">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Mixture Ratio (O/F) <Tooltip text="Ratio of oxidizer to fuel mass flow" />
                          </label>
                          <input type="number" name="mr" value={inputs.mr} onChange={handleInputChange} step="0.1" className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Fuel Temp (K) <Tooltip text="Inlet temperature of the fuel" />
                          </label>
                          <input type="number" name="T_fuel" value={inputs.T_fuel} onChange={handleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Ox Temp (K) <Tooltip text="Inlet temperature of the oxidizer" />
                          </label>
                          <input type="number" name="T_ox" value={inputs.T_ox} onChange={handleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none font-mono" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Flow Section */}
                  <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                    <button onClick={() => toggleSection('flow')} className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors">
                      <span className="text-xs font-bold tracking-widest uppercase text-slate-300">Flow Parameters</span>
                      {openSections.flow ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>
                    {openSections.flow && (
                      <div className="p-4 border-t border-white/5">
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Mass Flow Rate (ṁ) [kg/s] <Tooltip text="Total propellant mass entering the chamber per second" />
                          </label>
                          <input type="number" name="m_dot" value={inputs.m_dot} onChange={handleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none font-mono" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Injector Section */}
                  <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                    <button onClick={() => toggleSection('injector')} className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors">
                      <span className="text-xs font-bold tracking-widest uppercase text-slate-300">Injector Parameters</span>
                      {openSections.injector ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>
                    {openSections.injector && (
                      <div className="p-4 grid grid-cols-2 gap-4 border-t border-white/5">
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Type <Tooltip text="Design of the injector face affecting atomization" />
                          </label>
                          <select name="injector" value={inputs.injector} onChange={handleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none">
                            <option value="impinging">Impinging</option>
                            <option value="coaxial">Coaxial</option>
                            <option value="swirl">Swirl</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            ΔP (% of Pc) <Tooltip text="Pressure difference across injector for proper atomization" />
                          </label>
                          <input type="number" name="delta_P" value={inputs.delta_P} onChange={handleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none font-mono" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Geometry Section */}
                  <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                    <button onClick={() => toggleSection('geometry')} className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors">
                      <span className="text-xs font-bold tracking-widest uppercase text-slate-300">Chamber Geometry</span>
                      {openSections.geometry ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>
                    {openSections.geometry && (
                      <div className="p-4 grid grid-cols-2 gap-4 border-t border-white/5">
                        <div className="space-y-1 col-span-2">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Chamber Pressure (Pc) [bar] <Tooltip text="Pressure inside combustion chamber affecting performance and stability" />
                          </label>
                          <input type="number" name="Pc" value={inputs.Pc} onChange={handleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Length (m) <Tooltip text="Cylindrical length of the combustion chamber" />
                          </label>
                          <input type="number" name="L" value={inputs.L} onChange={handleInputChange} step="0.1" className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Diameter (m) <Tooltip text="Inner diameter of the combustion chamber" />
                          </label>
                          <input type="number" name="D" value={inputs.D} onChange={handleInputChange} step="0.1" className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-orange-500 p-2 text-sm outline-none font-mono" />
                        </div>
                      </div>
                    )}
                  </div>

                  <button 
                    onClick={handleComputeCombustion}
                    className="w-full mt-6 bg-white text-black hover:bg-slate-200 font-bold tracking-widest uppercase py-4 px-4 rounded transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(255,255,255,0.2)] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)]"
                  >
                    <Rocket className="w-5 h-5" />
                    Compute Combustion
                  </button>
                </div>

                {/* Results Panel */}
                <div className="lg:col-span-7 space-y-4">
                  <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-widest">Results Panel</h3>
                  {combustionResults ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-8 duration-500">
                      
                      {/* Top Metrics */}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        <ResultCard
                          title="Combustion Temp (Tc)"
                          value={combustionResults.Tc.toFixed(0)}
                          unit="K"
                          shortMeaning="Temperature generated during combustion."
                          fullExplanation="The stagnation temperature of the combustion gases inside the chamber. Higher temperatures generally yield higher performance but require advanced cooling techniques to prevent engine melting."
                          colorClass="orange"
                        />
                        <ResultCard
                          title="Char. Length (L*)"
                          value={combustionResults.L_star.toFixed(2)}
                          unit="m"
                          shortMeaning="Indicates combustion completeness and chamber sizing."
                          fullExplanation="The ratio of chamber volume to throat area. It dictates the residence time of propellants in the chamber. A proper L* ensures complete mixing and burning before gases exit the throat."
                          colorClass="orange"
                        />
                        <ResultCard
                          title="Efficiency (ηc)"
                          value={(combustionResults.eff * 100).toFixed(1)}
                          unit="%"
                          shortMeaning="Measure of how effectively fuel is burned."
                          fullExplanation="Indicates how completely the propellant burns inside the chamber compared to ideal theoretical conditions. It accounts for incomplete mixing, heat losses, and non-ideal reactions."
                          colorClass="orange"
                        />
                        <ResultCard
                          title="Specific Impulse (Isp)"
                          value={combustionResults.Isp.toFixed(0)}
                          unit="s"
                          shortMeaning="Thrust produced per unit propellant."
                          fullExplanation="Measures how effectively the engine produces thrust using propellant. Higher Isp means better fuel efficiency, allowing the vehicle to carry more payload or travel further."
                          colorClass="orange"
                        />
                        <ResultCard
                          title="Residence Time"
                          value={combustionResults.t_res.toFixed(1)}
                          unit="ms"
                          shortMeaning="Time propellant stays in chamber for combustion."
                          fullExplanation="The average time a propellant particle spends inside the combustion chamber. It must be long enough for complete vaporization, mixing, and chemical reaction, but short enough to minimize heat transfer to the walls."
                          colorClass="orange"
                        />
                        <ResultCard
                          title="Perf. Score"
                          value={combustionResults.perfScore}
                          unit="/100"
                          shortMeaning="Overall performance metric based on efficiency and stability risks."
                          fullExplanation="A composite score out of 100 that evaluates the overall health of the combustion design. It penalizes for stability risks (like low injector pressure drop or poor L/D ratio) and rewards high combustion efficiency."
                          colorClass="orange"
                        />
                      </div>

                      {/* Stability Warning Card */}
                      <div className={`p-6 rounded-lg border shadow-lg ${
                        combustionResults.stability === 'Stable' ? 'bg-emerald-500/10 border-emerald-500/30 shadow-emerald-500/10' :
                        combustionResults.stability === 'Medium Risk' ? 'bg-amber-500/10 border-amber-500/30 shadow-amber-500/10' :
                        'bg-red-500/10 border-red-500/30 shadow-red-500/10'
                      }`}>
                        <div className="flex items-center gap-3 mb-3">
                          {combustionResults.stability === 'Stable' ? <CheckCircle className="w-6 h-6 text-emerald-400" /> : <AlertTriangle className={`w-6 h-6 ${combustionResults.stability === 'Medium Risk' ? 'text-amber-400' : 'text-red-400'}`} />}
                          <div className={`text-lg font-bold tracking-widest uppercase ${
                            combustionResults.stability === 'Stable' ? 'text-emerald-400' :
                            combustionResults.stability === 'Medium Risk' ? 'text-amber-400' :
                            'text-red-400'
                          }`}>
                            Stability: {combustionResults.stability}
                            <Tooltip text="Indicates presence of oscillations or stable burning based on L/D, L*, and ΔP" />
                          </div>
                        </div>
                        <div className="text-sm text-slate-300 font-light leading-relaxed">
                          {combustionResults.explanation}
                        </div>
                      </div>
                      
                      <div className="pt-4 flex justify-end">
                        <button 
                          onClick={() => {
                            scrollTo('nozzle');
                            if (!exploredNozzle) setExploredNozzle(true);
                          }}
                          className="text-sm font-semibold tracking-widest uppercase text-white hover:text-orange-400 transition-colors flex items-center gap-2"
                        >
                          Proceed to Nozzle <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full min-h-[400px] flex flex-col items-center justify-center border border-white/10 bg-white/5 rounded-lg text-slate-500 text-sm tracking-widest uppercase gap-4">
                      <Activity className="w-8 h-8 opacity-20" />
                      Awaiting Computation
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* SECTION 2: NOZZLE MODULE */}
      <section id="nozzle" className="relative min-h-screen flex items-center justify-center px-6 py-24 bg-cover bg-center bg-fixed" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1517976487492-5750f3195933?q=80&w=2070&auto=format&fit=crop)' }}>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"></div>
        
        <div className="relative z-10 w-full max-w-6xl">
          {!exploredNozzle ? (
            <div className="text-center space-y-8 animate-in fade-in zoom-in-95 duration-700">
              <h2 className="text-5xl md:text-7xl font-bold text-white tracking-tighter uppercase">Nozzle Design</h2>
              <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto font-light">Design and optimize nozzle geometry to maximize thrust and expansion efficiency under varying atmospheric conditions.</p>
              <button 
                onClick={() => setExploredNozzle(true)} 
                className="mt-8 px-8 py-4 border border-white text-white hover:bg-white hover:text-black transition-all duration-300 tracking-widest uppercase text-sm font-semibold inline-flex items-center gap-3"
              >
                Explore Nozzle <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-8 md:p-12 shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="flex items-center gap-4 mb-8 border-b border-white/10 pb-6">
                <Wind className="w-8 h-8 text-sky-500" />
                <h2 className="text-3xl font-bold text-white tracking-tight uppercase">Nozzle Module</h2>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Inputs Panel */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-widest">Input Parameters</h3>
                  </div>

                  {/* Flow Conditions Section */}
                  <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                    <button onClick={() => toggleNozzleSection('flow')} className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors">
                      <span className="text-xs font-bold tracking-widest uppercase text-slate-300">Flow Conditions</span>
                      {openNozzleSections.flow ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>
                    {openNozzleSections.flow && (
                      <div className="p-4 grid grid-cols-2 gap-4 border-t border-white/5">
                        <div className="space-y-1 col-span-2">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Chamber Pressure (Pc) [bar] <Tooltip text="Stagnation pressure of the combustion gas entering the nozzle" />
                          </label>
                          <input type="number" name="Pc" value={nozzleInputs.Pc} onChange={handleNozzleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-sky-500 p-2 text-sm outline-none font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Mass Flow (ṁ) [kg/s] <Tooltip text="Total mass of propellant flowing through the nozzle per second" />
                          </label>
                          <input type="number" name="m_dot" value={nozzleInputs.m_dot} onChange={handleNozzleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-sky-500 p-2 text-sm outline-none font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Combustion Temp (Tc) [K] <Tooltip text="Stagnation temperature of the gas entering the nozzle" />
                          </label>
                          <input type="number" name="Tc" value={nozzleInputs.Tc} onChange={handleNozzleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-sky-500 p-2 text-sm outline-none font-mono" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Geometry Section */}
                  <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                    <button onClick={() => toggleNozzleSection('geometry')} className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors">
                      <span className="text-xs font-bold tracking-widest uppercase text-slate-300">Geometry</span>
                      {openNozzleSections.geometry ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>
                    {openNozzleSections.geometry && (
                      <div className="p-4 grid grid-cols-2 gap-4 border-t border-white/5">
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Throat Area (At) [m²] <Tooltip text="Cross-sectional area at the narrowest part of the nozzle" />
                          </label>
                          <input type="number" name="At" value={nozzleInputs.At} onChange={handleNozzleInputChange} step="0.001" className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-sky-500 p-2 text-sm outline-none font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Expansion Ratio (ε) <Tooltip text="Ratio of exit area to throat area (Ae/At)" />
                          </label>
                          <input type="number" name="eps" value={nozzleInputs.eps} onChange={handleNozzleInputChange} step="0.1" className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-sky-500 p-2 text-sm outline-none font-mono" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Environment Section */}
                  <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                    <button onClick={() => toggleNozzleSection('environment')} className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/10 transition-colors">
                      <span className="text-xs font-bold tracking-widest uppercase text-slate-300">Environment</span>
                      {openNozzleSections.environment ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>
                    {openNozzleSections.environment && (
                      <div className="p-4 border-t border-white/5">
                        <div className="space-y-1">
                          <label className="flex items-center text-[10px] font-medium text-slate-400 uppercase tracking-widest">
                            Ambient Pressure (Pa) [bar] <Tooltip text="Atmospheric pressure outside the nozzle exit" />
                          </label>
                          <select name="Pa" value={nozzleInputs.Pa} onChange={handleNozzleInputChange} className="w-full bg-black/50 border border-white/20 text-white rounded focus:border-sky-500 p-2 text-sm outline-none">
                            {Object.entries(ALTITUDES).map(([name, pa]) => (
                              <option key={name} value={pa}>{name} ({pa} bar)</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>

                  <button 
                    onClick={handleComputeNozzle}
                    className="w-full mt-6 bg-white text-black hover:bg-slate-200 font-bold tracking-widest uppercase py-4 px-4 rounded transition-all flex items-center justify-center gap-2 shadow-[0_0_15px_rgba(255,255,255,0.2)] hover:shadow-[0_0_25px_rgba(255,255,255,0.4)]"
                  >
                    <Wind className="w-5 h-5" />
                    Compute Nozzle
                  </button>
                </div>

                {/* Results Panel */}
                <div className="lg:col-span-7 space-y-4">
                  <h3 className="text-sm font-semibold text-sky-400 uppercase tracking-widest">Results Panel</h3>
                  {nozzleResults ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-8 duration-500">
                      
                      {/* Top Metrics */}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        <ResultCard
                          title="Exit Area (Ae)"
                          value={(nozzleResults.Ae * 10000).toFixed(1)}
                          unit="cm²"
                          shortMeaning="Cross-sectional area at the nozzle exit."
                          fullExplanation="The physical area at the end of the nozzle bell. It determines how much the exhaust gases can expand before leaving the engine, directly impacting the exit pressure and thrust."
                          colorClass="sky"
                        />
                        <ResultCard
                          title="Exit Pressure (Pe)"
                          value={nozzleResults.Pe.toFixed(3)}
                          unit="bar"
                          shortMeaning="Static pressure of the gas at the nozzle exit."
                          fullExplanation="The pressure of the exhaust gases as they leave the nozzle. For maximum thrust, this should perfectly match the ambient atmospheric pressure."
                          colorClass="sky"
                        />
                        <ResultCard
                          title="Exhaust Velocity (Ve)"
                          value={nozzleResults.Ve.toFixed(0)}
                          unit="m/s"
                          shortMeaning="Velocity of the gas leaving the nozzle."
                          fullExplanation="The speed at which the exhaust gases are expelled from the engine. Higher exhaust velocity directly translates to higher thrust and better specific impulse (Isp)."
                          colorClass="sky"
                        />
                        <ResultCard
                          title="Thrust (F)"
                          value={nozzleResults.Thrust.toFixed(1)}
                          unit="kN"
                          shortMeaning="Total force generated by the nozzle."
                          fullExplanation="The forward force produced by the engine, calculated from the momentum of the exhaust gases and the pressure difference between the nozzle exit and the ambient atmosphere."
                          colorClass="sky"
                        />
                        <ResultCard
                          title="Specific Impulse (Isp)"
                          value={nozzleResults.Isp.toFixed(0)}
                          unit="s"
                          shortMeaning="Thrust produced per unit propellant."
                          fullExplanation="Measures how effectively the engine produces thrust using propellant. Higher Isp means better fuel efficiency."
                          colorClass="sky"
                        />
                        <ResultCard
                          title="Efficiency (ηn)"
                          value={(nozzleResults.eta_n * 100).toFixed(1)}
                          unit="%"
                          shortMeaning="Nozzle expansion efficiency considering losses."
                          fullExplanation="Represents how well the nozzle converts thermal energy into kinetic energy. It accounts for losses due to flow divergence, friction, and non-ideal expansion (over/under-expanded flow)."
                          colorClass="sky"
                        />
                      </div>

                      {/* Expansion Condition Card */}
                      <div className={`p-6 rounded-lg border shadow-lg ${
                        nozzleResults.condition === 'Ideally expanded' ? 'bg-emerald-500/10 border-emerald-500/30 shadow-emerald-500/10' :
                        nozzleResults.condition === 'Under-expanded' ? 'bg-sky-500/10 border-sky-500/30 shadow-sky-500/10' :
                        'bg-orange-500/10 border-orange-500/30 shadow-orange-500/10'
                      }`}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <Wind className={`w-6 h-6 ${
                              nozzleResults.condition === 'Ideally expanded' ? 'text-emerald-400' :
                              nozzleResults.condition === 'Under-expanded' ? 'text-sky-400' :
                              'text-orange-400'
                            }`} />
                            <div className={`text-lg font-bold tracking-widest uppercase ${
                              nozzleResults.condition === 'Ideally expanded' ? 'text-emerald-400' :
                              nozzleResults.condition === 'Under-expanded' ? 'text-sky-400' :
                              'text-orange-400'
                            }`}>
                              Flow: {nozzleResults.condition}
                              <Tooltip text="Compares exit pressure to ambient pressure to determine plume shape" />
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">Perf. Score</div>
                            <div className="text-xl font-mono text-white">{nozzleResults.perfScore} <span className="text-xs font-sans text-slate-500">/100</span></div>
                          </div>
                        </div>
                        <div className="text-sm text-slate-300 font-light leading-relaxed">
                          {nozzleResults.explanation}
                        </div>
                        {nozzleResults.warnings.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {nozzleResults.warnings.map((w, i) => (
                              <div key={i} className={`text-xs flex items-start gap-2 p-3 rounded border ${w.includes('CRITICAL') ? 'text-red-400 font-bold bg-red-500/10 border-red-500/30' : 'text-orange-300 bg-orange-500/10 border-orange-500/30'}`}>
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                {w}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-4 pt-4 border-t border-white/10 text-xs text-slate-400 flex items-center gap-2">
                          <Lightbulb className="w-4 h-4 text-indigo-400" />
                          <span>Optimal Expansion Ratio (ε) for current altitude: <strong className="text-white font-mono">{nozzleResults.optimalEps.toFixed(1)}</strong></span>
                        </div>
                      </div>
                      
                      <div className="pt-4 flex justify-end">
                        <button 
                          onClick={() => {
                            scrollTo('ai');
                            if (!exploredAI) setExploredAI(true);
                          }}
                          className="text-sm font-semibold tracking-widest uppercase text-white hover:text-sky-400 transition-colors flex items-center gap-2"
                        >
                          View AI Intelligence <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full min-h-[400px] flex flex-col items-center justify-center border border-white/10 bg-white/5 rounded-lg text-slate-500 text-sm tracking-widest uppercase gap-4">
                      <Activity className="w-8 h-8 opacity-20" />
                      Awaiting Computation
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* SECTION 3: AI INTELLIGENCE MODULE */}
      <section id="ai" className="relative min-h-screen flex items-center justify-center px-6 py-24 bg-cover bg-center bg-fixed" style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop)' }}>
        <div className="absolute inset-0 bg-black/80 backdrop-blur-[2px]"></div>
        
        <div className="relative z-10 w-full max-w-6xl">
          {!exploredAI ? (
            <div className="text-center space-y-8 animate-in fade-in zoom-in-95 duration-700">
              <h2 className="text-5xl md:text-7xl font-bold text-white tracking-tighter uppercase">AI Intelligence</h2>
              <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto font-light">Get explainable insights, performance improvements, and engineering suggestions powered by physics-informed AI.</p>
              <button 
                onClick={() => setExploredAI(true)} 
                className="mt-8 px-8 py-4 border border-white text-white hover:bg-white hover:text-black transition-all duration-300 tracking-widest uppercase text-sm font-semibold inline-flex items-center gap-3"
              >
                Access Intelligence <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-8 md:p-12 shadow-2xl animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="flex items-center gap-4 mb-8 border-b border-white/10 pb-6">
                <Lightbulb className="w-8 h-8 text-indigo-400" />
                <h2 className="text-3xl font-bold text-white tracking-tight uppercase">AI Engineering Intelligence</h2>
              </div>
              
              {!aiSuggestions ? (
                <div className="h-[300px] flex flex-col items-center justify-center border border-white/10 bg-white/5 text-slate-500 text-sm tracking-widest uppercase gap-4">
                  <AlertTriangle className="w-8 h-8 opacity-50" />
                  <p>Complete Combustion and Nozzle analysis first</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Left Column: State & Performance */}
                  <div className="lg:col-span-5 space-y-6">
                    <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-widest">1. Current Engine State</h3>
                    <div className="p-6 bg-white/5 border border-white/10 rounded-xl text-sm leading-relaxed text-slate-300 font-light break-words">
                      <p className="mb-4">{aiSuggestions.currentState.explanation}</p>
                      <div className="space-y-2 mt-4 pt-4 border-t border-white/10">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Combustion Status:</span>
                          <strong className={aiSuggestions.currentState.combustionStatus === 'Optimal' ? 'text-emerald-400' : aiSuggestions.currentState.combustionStatus === 'Moderate' ? 'text-amber-400' : 'text-red-400'}>{aiSuggestions.currentState.combustionStatus}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Nozzle Status:</span>
                          <strong className={aiSuggestions.currentState.nozzleStatus === 'Ideal' ? 'text-emerald-400' : aiSuggestions.currentState.nozzleStatus === 'Under-expanded' ? 'text-sky-400' : 'text-orange-400'}>{aiSuggestions.currentState.nozzleStatus}</strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Overall Health Score:</span>
                          <strong className="text-white font-mono">{aiSuggestions.currentState.healthScore}/100</strong>
                        </div>
                      </div>
                    </div>

                    <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-widest mt-8">4. Performance Improvement</h3>
                    <div className="p-6 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-sm leading-relaxed text-slate-300 font-light break-words">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <strong className="text-indigo-300 font-medium tracking-wide uppercase text-xs block mb-2">Current</strong>
                          <ul className="space-y-1 text-xs">
                            <li>Thrust: <span className="text-white font-mono">{aiSuggestions.comparison.current.thrust} kN</span></li>
                            <li>Efficiency: <span className="text-white font-mono">{aiSuggestions.comparison.current.eff}%</span></li>
                            <li>Isp: <span className="text-white font-mono">{aiSuggestions.comparison.current.isp} s</span></li>
                          </ul>
                        </div>
                        <div>
                          <strong className="text-emerald-400 font-medium tracking-wide uppercase text-xs block mb-2">Optimized</strong>
                          <ul className="space-y-1 text-xs">
                            <li>Thrust: <span className="text-emerald-400 font-mono">{aiSuggestions.comparison.optimized.thrust}</span></li>
                            <li>Efficiency: <span className="text-emerald-400 font-mono">{aiSuggestions.comparison.optimized.eff}</span></li>
                            <li>Isp: <span className="text-emerald-400 font-mono">{aiSuggestions.comparison.optimized.isp}</span></li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Issues, Optimization & Recommendations */}
                  <div className="lg:col-span-7 space-y-6">
                    <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-widest">2. Key Issues Identified</h3>
                    <div className="space-y-3">
                      {aiSuggestions.issues.map((issue, idx) => (
                        <div key={idx} className="p-4 rounded-lg border border-white/10 bg-white/5 flex items-start gap-3">
                          <div className="mt-0.5 shrink-0 text-sm">
                            {issue.severity.includes('🔴') ? '🔴' : issue.severity.includes('🟡') ? '🟡' : '🟢'}
                          </div>
                          <div>
                            <strong className={`text-xs uppercase tracking-widest block mb-1 ${issue.severity.includes('🔴') ? 'text-red-400' : issue.severity.includes('🟡') ? 'text-amber-400' : 'text-emerald-400'}`}>
                              {issue.severity.replace(/[🔴🟡🟢] /, '')}
                            </strong>
                            <p className="text-sm text-slate-300 font-light">{issue.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-widest mt-8">3. AI Optimized Engine Version</h3>
                    <div className="p-5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-sm leading-relaxed text-emerald-100 font-light break-words">
                      {aiSuggestions.optimizedVersion}
                    </div>

                    <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-widest mt-8">5. Engineering Recommendations</h3>
                    <ul className="space-y-2">
                      {aiSuggestions.recommendations.map((rec, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-300 font-light">
                          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>

                    <h3 className="text-sm font-semibold text-indigo-400 uppercase tracking-widest mt-8">6. AI Summary (Smart Insight)</h3>
                    <div className="p-5 bg-white/5 border border-white/10 rounded-xl text-sm leading-relaxed text-white font-medium break-words italic">
                      "{aiSuggestions.summary}"
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* SECTION 4: FEEDBACK & IMPROVEMENTS */}
      <section id="feedback" className="relative py-24 bg-black border-t border-white/10">
        <div className="max-w-3xl mx-auto px-6 relative z-10">
          <div className="bg-white/5 backdrop-blur-md border border-sky-500/30 rounded-2xl p-8 md:p-12 shadow-[0_0_30px_rgba(14,165,233,0.1)] text-center animate-in fade-in slide-in-from-bottom-8 duration-1000">
            <MessageSquare className="w-8 h-8 text-sky-400 mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white tracking-tight uppercase mb-2">Feedback & Improvements</h2>
            <p className="text-slate-400 font-light mb-8">We value your feedback to improve this AI-powered engineering platform.</p>

            {isFeedbackSubmitted ? (
              <div className="bg-sky-500/20 border border-sky-500/50 text-sky-300 p-6 rounded-xl animate-in fade-in zoom-in duration-500">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-sky-400" />
                <p className="font-medium tracking-widest uppercase">Thank you for your feedback!</p>
              </div>
            ) : (
              <form onSubmit={handleFeedbackSubmit} className="space-y-6 text-left">
                <div>
                  <label className="block text-xs font-medium text-sky-400 uppercase tracking-widest mb-2">Name (Optional)</label>
                  <input 
                    type="text" 
                    value={feedbackName} 
                    onChange={e => setFeedbackName(e.target.value)} 
                    className="w-full bg-black/50 border border-white/10 text-white rounded-xl focus:border-sky-500 focus:ring-1 focus:ring-sky-500 p-4 outline-none transition-colors" 
                    placeholder="Enter your name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-sky-400 uppercase tracking-widest mb-2">Feedback (Required)</label>
                  <textarea 
                    required 
                    value={feedbackText} 
                    onChange={e => setFeedbackText(e.target.value)} 
                    rows={4} 
                    className="w-full bg-black/50 border border-white/10 text-white rounded-xl focus:border-sky-500 focus:ring-1 focus:ring-sky-500 p-4 outline-none transition-colors resize-none" 
                    placeholder="Share your thoughts or suggestions..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-sky-400 uppercase tracking-widest mb-2 flex justify-between">
                    <span>Rating</span>
                    <span className="text-white">{feedbackRating} / 5</span>
                  </label>
                  <input 
                    type="range" 
                    min="1" 
                    max="5" 
                    value={feedbackRating} 
                    onChange={e => setFeedbackRating(parseInt(e.target.value))} 
                    className="w-full accent-sky-500 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer" 
                  />
                </div>
                <button 
                  type="submit" 
                  className="w-full bg-sky-500/10 border border-sky-500 text-sky-400 hover:bg-sky-500 hover:text-white font-bold tracking-widest uppercase py-4 rounded-xl transition-all duration-300 shadow-[0_0_15px_rgba(14,165,233,0.2)] hover:shadow-[0_0_25px_rgba(14,165,233,0.4)]"
                >
                  Submit Feedback
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* DEVELOPER CREDIT FOOTER */}
      <footer className="bg-black py-16 border-t border-white/10 text-center animate-in fade-in duration-1000">
        <div className="flex justify-center mb-6">
          <Rocket className="w-6 h-6 text-slate-600 hover:text-sky-400 transition-colors duration-500" />
        </div>
        <div className="space-y-2">
          <p className="text-slate-300 text-sm tracking-widest uppercase font-medium">Developed by Vishali</p>
          <p className="text-slate-500 text-xs tracking-widest uppercase">Aerospace Engineer <span className="mx-2 text-slate-700">|</span> Propulsion Enthusiast</p>
        </div>
      </footer>
    </div>
  );
}
