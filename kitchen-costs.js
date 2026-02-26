// kitchen-costs.js (CANÓNICO para Costos)
// Ingredientes SIN paréntesis y agrupados por secciones (acordeones)

window.AMARED_COSTS_SECTIONS = [
  {
    title: "Ingredientes que comparten todos los postres",
    keys: [
      "Leche condensada",
      "Envase plástico",
      "Cuchara plástica",
      "Agua"
    ]
  },
  {
    title: "Ingredientes que comparten Mousse de maracuyá y Arroz con leche",
    keys: [
      "Leche entera"
    ]
  },
  {
    title: "Ingredientes que comparten Mousse de maracuyá y Cheesecake de café con panela",
    keys: [
      "Crema de leche",
      "Mantequilla sin sal",
      "Vainilla",
      "Gelatina sin sabor"
    ]
  },
  {
    title: "Ingredientes que comparten Cheesecake de café con panela y Arroz con leche",
    keys: [
      "Sal"
    ]
  },
  {
    title: "Ingredientes para Mousse de maracuyá",
    keys: [
      "Pulpa de maracuyá",
      "Galletas saladas",
      "Chocorramo",
      "Chocolate en polvo"
    ]
  },
  {
    title: "Ingredientes para Arroz con leche",
    keys: [
      "Arroz blanco",
      "Azúcar",
      "Canela en astilla",
      "Queso costeño"
    ]
  },
  {
    title: "Ingredientes para Cheesecake de café con panela",
    keys: [
      "Galleta de leche",
      "Queso crema",
      "Café",
      "Panela"
    ]
  }
];

// (Opcional) Si quieres mantener un objeto de precios legacy, lo dejamos vacío
window.AMARED_INGREDIENT_PRICES = window.AMARED_INGREDIENT_PRICES || {};
