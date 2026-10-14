const { meals, drinks, workouts } = require('./data');

const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, high: 1.725 };

// Minimos de seguridad: el plan nunca baja de aqui, sin importar el objetivo.
const MIN_KCAL = { male: 1500, female: 1200 };

function bmiOf(weightKg, heightCm) {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return 'bajo peso';
  if (bmi < 25) return 'peso normal';
  if (bmi < 30) return 'sobrepeso';
  return 'obesidad';
}

// Mifflin-St Jeor
function bmr({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

function validateProfile(p) {
  const errors = [];
  if (!(p.heightCm >= 120 && p.heightCm <= 230)) errors.push('Altura fuera de rango (120 a 230 cm).');
  if (!(p.weightKg >= 30 && p.weightKg <= 300)) errors.push('Peso fuera de rango (30 a 300 kg).');
  if (!(p.age >= 13 && p.age <= 100)) errors.push('Edad fuera de rango (13 a 100 anios).');
  if (!['male', 'female'].includes(p.sex)) errors.push('Selecciona sexo.');
  if (!ACTIVITY[p.activity]) errors.push('Selecciona nivel de actividad.');
  return errors;
}

function buildPlan(p) {
  const bmi = bmiOf(p.weightKg, p.heightCm);
  const category = bmiCategory(bmi);
  const isMinor = p.age < 18;
  const pregnantOrCondition = !!p.hasCondition; // embarazo, diabetes, trastorno alimenticio, etc.

  const tdee = Math.round(bmr(p) * ACTIVITY[p.activity]);

  let goal = 'maintain';
  if (bmi >= 25) goal = 'lose';
  if (bmi < 18.5) goal = 'gain';

  const warnings = [];
  const notes = [];

  // Reglas de seguridad
  if (isMinor && goal === 'lose') {
    goal = 'maintain';
    warnings.push('Eres menor de edad: esta app no genera planes de perdida de peso para menores. Habla con tu medico o pediatra.');
  }
  if (pregnantOrCondition) {
    goal = 'maintain';
    warnings.push('Indicaste una condicion de salud especial. Te mostramos solo un plan de mantenimiento general; consulta a tu medico o nutriologo antes de seguir cualquier plan.');
  }

  let targetKcal = tdee;
  let tone = 'balanced';
  let headline = 'Tu plan de mantenimiento';

  if (goal === 'lose') {
    // Deficit moderado: 15% (sobrepeso) o 20% (obesidad). Nunca por debajo del minimo seguro.
    const deficit = category === 'obesidad' ? 0.2 : 0.15;
    targetKcal = Math.max(Math.round(tdee * (1 - deficit)), MIN_KCAL[p.sex]);
    tone = 'strict';
    headline = 'Plan firme: vamos con constancia';
    notes.push('Este plan es exigente en constancia, pero seguro: deficit moderado y nunca por debajo de un minimo de calorias.');
    notes.push('Meta realista: 0.5 a 1 kg por semana como maximo. Mas rapido no es mejor.');
  } else if (goal === 'gain') {
    targetKcal = tdee + 400;
    headline = 'Plan para ganar peso de forma sana';
    notes.push('Tu IMC esta por debajo de lo recomendado. Come con regularidad y prioriza proteina y fuerza.');
    if (bmi < 17) warnings.push('Tu IMC es muy bajo. Te recomendamos consultar con un profesional de salud.');
  } else {
    notes.push('Mantendras tu peso con una alimentacion equilibrada y actividad constante.');
  }

  const week = buildWeek(goal, targetKcal);
  // El catalogo es limitado: si el menu no alcanza la meta, se avisa para que no se coma de menos sin querer
  const shortfall = targetKcal - Math.min(...week.map((d) => d.approxKcal));
  if (shortfall > targetKcal * 0.08) {
    notes.push(`Tu meta de ${targetKcal} kcal es alta y el menú de ejemplo se queda un poco corto. Completa con más porción de proteína, verduras y carbohidratos integrales para llegar a tu meta. No comas menos de lo indicado.`);
  }

  const protein = Math.round(p.weightKg * (goal === 'gain' ? 1.8 : goal === 'lose' ? 1.6 : 1.4));
  const waterL = Math.round((p.weightKg * 0.035 + (p.activity === 'high' ? 0.5 : 0)) * 10) / 10;

  return {
    metrics: { bmi: Math.round(bmi * 10) / 10, category, tdee, targetKcal, proteinG: protein, waterL },
    goal,
    tone,
    headline,
    notes,
    warnings,
    week,
    drinks: drinks.filter((d) => d.goals.includes(goal)),
    workouts: workouts[goal],
    disclaimer: 'Esta app es solo informativa y no sustituye a un medico o nutriologo.',
  };
}

// Arma 7 dias eligiendo comidas que se acerquen al objetivo calorico diario.
function buildWeek(goal, targetKcal) {
  const byType = (t) => meals.filter((m) => m.type === t && m.goals.includes(goal));
  const pools = {
    desayuno: byType('desayuno'),
    comida: byType('comida'),
    cena: byType('cena'),
    snack: byType('snack'),
  };
  const days = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];

  return days.map((day, i) => {
    const pick = (t) => {
      const pool = pools[t].length ? pools[t] : meals.filter((m) => m.type === t);
      return pool[i % pool.length];
    };
    const items = [pick('desayuno'), pick('comida'), pick('snack'), pick('cena')];
    let total = items.reduce((s, m) => s + m.kcal, 0);
    // Si el menu base se queda corto aun con porciones al maximo, agrega una segunda colacion
    const pool = meals.filter((m) => m.type === 'snack'); // para completar calorias sirve cualquier colacion
    for (let k = 1; k < pool.length && total * 1.3 < targetKcal; k++) {
      const extra = pool[(i + k) % pool.length];
      if (items.some((x) => x.id === extra.id)) continue;
      items.splice(items.length - 1, 0, extra);
      total += extra.kcal;
    }
    // Factor de porcion para acercar el total al objetivo (limitado para no exagerar)
    const portion = Math.min(1.8, Math.max(0.7, targetKcal / total));
    return {
      day,
      portionFactor: Math.round(portion * 100) / 100,
      approxKcal: Math.round(total * portion),
      items: items.map((m) => ({ ...m, kcalAdjusted: Math.round(m.kcal * portion) })),
    };
  });
}

module.exports = { buildPlan, validateProfile, bmiOf, bmiCategory };
