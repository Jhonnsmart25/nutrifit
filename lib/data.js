// Catalogo base de recetas, bebidas y rutinas. Edita libremente o mueve esto a una base de datos.
// kcal = por porcion aproximada. "goals": lose | maintain | gain

const meals = [
  // Desayunos
  { id: 'd1', type: 'desayuno', name: 'Omelette de claras con espinacas y nopal', kcal: 280, protein: 26, goals: ['lose', 'maintain'], steps: 'Bate 4 claras y 1 huevo, cocina con espinaca y nopal picado en sarten antiadherente. Acompana con 1 tortilla de maiz.' },
  { id: 'd2', type: 'desayuno', name: 'Avena con platano y canela', kcal: 340, protein: 12, goals: ['lose', 'maintain'], steps: 'Cuece 1/2 taza de avena en agua o leche light, agrega 1/2 platano en rodajas y canela.' },
  { id: 'd3', type: 'desayuno', name: 'Huevos a la mexicana con frijoles', kcal: 420, protein: 24, goals: ['maintain', 'gain'], steps: '2 huevos con jitomate, cebolla y chile. Sirve con 1/2 taza de frijoles y 2 tortillas.' },
  { id: 'd4', type: 'desayuno', name: 'Hot cakes de avena y proteina con fruta', kcal: 560, protein: 34, goals: ['gain'], steps: 'Licua 1 taza de avena, 2 huevos, 1 platano y polvo de proteina. Cocina y sirve con fruta y miel.' },
  { id: 'd5', type: 'desayuno', name: 'Yogur griego con fruta y nueces', kcal: 300, protein: 20, goals: ['lose', 'maintain'], steps: '3/4 taza de yogur griego natural, fruta picada y 1 cucharada de nueces.' },
  // Comidas
  { id: 'c1', type: 'comida', name: 'Pechuga a la plancha con ensalada y arroz integral', kcal: 480, protein: 42, goals: ['lose', 'maintain'], steps: '150 g de pechuga con limon y ajo, 1 taza de ensalada verde y 1/2 taza de arroz integral.' },
  { id: 'c2', type: 'comida', name: 'Caldo de pollo con verduras', kcal: 350, protein: 30, goals: ['lose', 'maintain'], steps: 'Hierve pollo sin piel con zanahoria, calabaza, chayote y epazote. Sirve sin tortillas fritas.' },
  { id: 'c3', type: 'comida', name: 'Bowl de atun, frijoles y aguacate', kcal: 520, protein: 38, goals: ['maintain', 'gain'], steps: '1 lata de atun en agua, 1/2 taza de frijoles, 1/4 de aguacate, jitomate, cebolla y limon.' },
  { id: 'c4', type: 'comida', name: 'Tacos de pescado al horno', kcal: 450, protein: 35, goals: ['lose', 'maintain'], steps: 'Hornea filete de pescado con especias, sirve en 3 tortillas con col morada y salsa de yogur.' },
  { id: 'c5', type: 'comida', name: 'Arroz con pollo, verduras y lentejas', kcal: 680, protein: 46, goals: ['gain'], steps: '200 g de pollo, 1 taza de arroz, 1/2 taza de lentejas y verduras salteadas con aceite de oliva.' },
  { id: 'c6', type: 'comida', name: 'Pasta integral con carne molida magra', kcal: 640, protein: 40, goals: ['gain', 'maintain'], steps: '1 taza de pasta integral cocida, 150 g de carne molida magra en salsa de jitomate natural.' },
  // Cenas
  { id: 'n1', type: 'cena', name: 'Tostadas horneadas de tinga de pollo light', kcal: 320, protein: 28, goals: ['lose', 'maintain'], steps: '2 tostadas horneadas con pollo deshebrado en salsa de jitomate y chipotle, lechuga y cebolla.' },
  { id: 'n2', type: 'cena', name: 'Crema de calabacita con queso panela', kcal: 260, protein: 16, goals: ['lose'], steps: 'Licua calabacitas cocidas con caldo, sirve con cubos de queso panela asado.' },
  { id: 'n3', type: 'cena', name: 'Salmon con papas al horno y brocoli', kcal: 560, protein: 38, goals: ['maintain', 'gain'], steps: '150 g de salmon, 1 papa mediana y brocoli al vapor, todo al horno con un chorrito de aceite de oliva.' },
  { id: 'n4', type: 'cena', name: 'Quesadillas de maiz con champinones y frijol', kcal: 480, protein: 24, goals: ['maintain', 'gain'], steps: '3 tortillas con queso oaxaca, champinones salteados y frijoles refritos light.' },
  // Snacks
  { id: 's1', type: 'snack', name: 'Pepino, jicama y limon con chile', kcal: 80, protein: 2, goals: ['lose', 'maintain'], steps: 'Corta en bastones, anade limon y chile en polvo.' },
  { id: 's2', type: 'snack', name: 'Manzana con crema de cacahuate', kcal: 200, protein: 5, goals: ['maintain', 'gain'], steps: '1 manzana en gajos con 1 cucharada de crema de cacahuate natural.' },
  { id: 's3', type: 'snack', name: 'Licuado de platano, avena y leche', kcal: 380, protein: 18, goals: ['gain'], steps: 'Licua 1 platano, 1/2 taza de avena, 1 taza de leche y 1 cucharada de crema de cacahuate.' },
  { id: 's4', type: 'snack', name: 'Palomitas naturales', kcal: 110, protein: 3, goals: ['lose', 'maintain'], steps: '3 tazas de palomitas hechas sin aceite, con sal y limon.' },
];

const drinks = [
  { id: 'b1', name: 'Agua de jamaica sin azucar', kcal: 5, goals: ['lose', 'maintain', 'gain'], note: 'Hidratante y casi sin calorias. Endulza con stevia si lo necesitas.' },
  { id: 'b2', name: 'Agua infusionada de pepino y limon', kcal: 5, goals: ['lose', 'maintain'], note: 'Ideal para sustituir refrescos.' },
  { id: 'b3', name: 'Te verde o de manzanilla', kcal: 0, goals: ['lose', 'maintain'], note: 'Sin azucar. Buena opcion por la noche (manzanilla).' },
  { id: 'b4', name: 'Licuado verde (nopal, pina, apio)', kcal: 90, goals: ['lose', 'maintain'], note: 'Con fibra. No agregues azucar ni jugos industriales.' },
  { id: 'b5', name: 'Leche con cacao y platano', kcal: 280, goals: ['gain'], note: 'Aporta calorias y proteina para subir de peso de forma sana.' },
  { id: 'b6', name: 'Agua natural', kcal: 0, goals: ['lose', 'maintain', 'gain'], note: 'La base: apunta a 2 a 3 litros al dia segun tu actividad.' },
];

// Rutinas por objetivo. impact: low | mid
const workouts = {
  lose: [
    { day: 'Lunes', title: 'Caminata activa + fuerza suave', minutes: 40, impact: 'low', exercises: ['Caminata rapida 20 min', 'Sentadillas a silla 3x12', 'Remo con liga 3x12', 'Plancha en rodillas 3x20 s'] },
    { day: 'Martes', title: 'Descanso activo', minutes: 20, impact: 'low', exercises: ['Estiramientos 10 min', 'Caminata ligera 10 min'] },
    { day: 'Miercoles', title: 'Cardio en intervalos', minutes: 35, impact: 'low', exercises: ['Calentamiento 5 min', 'Intervalos: 1 min rapido / 2 min suave x 8', 'Enfriamiento 5 min'] },
    { day: 'Jueves', title: 'Fuerza de cuerpo completo', minutes: 40, impact: 'low', exercises: ['Zancadas 3x10', 'Flexiones inclinadas 3x10', 'Puente de gluteo 3x15', 'Peso muerto con mochila 3x12'] },
    { day: 'Viernes', title: 'Caminata larga', minutes: 45, impact: 'low', exercises: ['Caminata continua 45 min a paso firme'] },
    { day: 'Sabado', title: 'Actividad libre', minutes: 30, impact: 'low', exercises: ['Bici, baile, natacion o deporte que disfrutes'] },
    { day: 'Domingo', title: 'Descanso', minutes: 0, impact: 'low', exercises: ['Descanso completo y buena hidratacion'] },
  ],
  maintain: [
    { day: 'Lunes', title: 'Fuerza tren superior', minutes: 45, impact: 'mid', exercises: ['Flexiones 4x10', 'Remo con mancuerna 4x10', 'Press de hombro 3x12', 'Plancha 3x40 s'] },
    { day: 'Martes', title: 'Cardio moderado', minutes: 30, impact: 'mid', exercises: ['Trote suave o bici 30 min'] },
    { day: 'Miercoles', title: 'Fuerza tren inferior', minutes: 45, impact: 'mid', exercises: ['Sentadillas 4x12', 'Peso muerto rumano 4x10', 'Zancadas 3x12', 'Elevacion de talones 3x15'] },
    { day: 'Jueves', title: 'Movilidad y core', minutes: 25, impact: 'low', exercises: ['Yoga o estiramientos 15 min', 'Core: bicicleta abdominal 3x20'] },
    { day: 'Viernes', title: 'Circuito de cuerpo completo', minutes: 40, impact: 'mid', exercises: ['Burpees 3x8', 'Sentadilla con salto 3x10', 'Mountain climbers 3x30 s', 'Remo 3x12'] },
    { day: 'Sabado', title: 'Actividad libre', minutes: 40, impact: 'mid', exercises: ['Deporte, senderismo o bici'] },
    { day: 'Domingo', title: 'Descanso', minutes: 0, impact: 'low', exercises: ['Descanso y estiramientos suaves'] },
  ],
  gain: [
    { day: 'Lunes', title: 'Empuje (pecho, hombro, triceps)', minutes: 50, impact: 'mid', exercises: ['Flexiones o press 4x8', 'Press de hombro 4x8', 'Fondos de triceps 3x10'] },
    { day: 'Martes', title: 'Tiron (espalda, biceps)', minutes: 50, impact: 'mid', exercises: ['Dominadas o jalon 4x8', 'Remo 4x8', 'Curl de biceps 3x10'] },
    { day: 'Miercoles', title: 'Descanso', minutes: 0, impact: 'low', exercises: ['Descanso, buena comida y sueno'] },
    { day: 'Jueves', title: 'Pierna', minutes: 55, impact: 'mid', exercises: ['Sentadilla 4x8', 'Peso muerto rumano 4x8', 'Prensa o zancadas 3x10'] },
    { day: 'Viernes', title: 'Cuerpo completo ligero', minutes: 40, impact: 'mid', exercises: ['Circuito basico 3 vueltas', 'Core 3x20'] },
    { day: 'Sabado', title: 'Cardio ligero', minutes: 20, impact: 'low', exercises: ['Caminata o bici suave 20 min'] },
    { day: 'Domingo', title: 'Descanso', minutes: 0, impact: 'low', exercises: ['Descanso completo'] },
  ],
};

module.exports = { meals, drinks, workouts };
