// kitchen-costs.js (AMARED)
// ✅ Lista CANÓNICA de ingredientes (sin paréntesis, sin duplicados).
// La unidad se define en la página de costos (g / ml / unidad).

window.AMARED_INGREDIENT_GROUPS = [
  {
    id: "shared_all",
    title: "Ingredientes que comparten todos los postres",
    keys: ["Leche condensada"]
  },
  {
    id: "shared_mousse_rice",
    title: "Ingredientes que comparten Mousse de maracuyá y Arroz con leche",
    keys: ["Leche entera"]
  },
  {
    id: "shared_mousse_cheesecake",
    title: "Ingredientes que comparten Mousse y Cheesecake",
    keys: ["Crema de leche", "Mantequilla sin sal", "Vainilla", "Gelatina sin sabor"]
  },
  {
    id: "shared_cheesecake_rice",
    title: "Ingredientes que comparten Cheesecake y Arroz con leche",
    keys: ["Sal"]
  },
  {
    id: "mousse",
    title: "Postre: Mousse de maracuyá",
    keys: ["Pulpa de maracuyá", "Galletas saladas", "Chocorramo", "Chocolate en polvo"]
  },
  {
    id: "rice",
    title: "Postre: Arroz con leche (puede cambiar)",
    keys: ["Arroz blanco", "Agua", "Azúcar", "Canela en astilla", "Queso costeño"]
  },
  {
    id: "cheesecake",
    title: "Postre: Cheesecake de café con panela",
    keys: ["Galleta de leche", "Queso crema", "Café", "Panela", "Harina de galleta de leche"]
  }
];

// Precios por unidad (COP) -> se sobreescriben con lo que venga de Sheets/localStorage.
window.AMARED_INGREDIENT_PRICES = (function(){
  const all = {};
  for (const g of window.AMARED_INGREDIENT_GROUPS) {
    for (const k of g.keys) all[k] = 0;
  }
  return all;
})();
