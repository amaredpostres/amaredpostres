// kitchen-costs.js
// Precios por unidad (COP):
// - Si eliges unidad "g": COP por gramo
// - Si eliges unidad "ml": COP por mililitro
// - Si eliges unidad "unidad": COP por unidad
//
// ✅ IMPORTANTE:
// - Aquí NO incluimos la unidad en el nombre (ej: "Leche condensada").
// - La unidad se selecciona manualmente en la página de Costos.
// - Duplicados como "Leche condensada (g/ml)" se unifican en un solo ingrediente.

window.AMARED_INGREDIENT_PRICES = {
  // Base comunes
  "Pulpa maracuyá": 0,
  "Leche condensada": 0,
  "Crema de leche": 0,
  "Leche entera": 0,
  "Gelatina sin sabor": 0,
  "Agua gelatina": 0,
  "Vainilla": 0,

  // Bases y mezclas
  "Galletas trituradas": 0,
  "Mantequilla": 0,

  // Toppings / decoraciones
  "Chocorramo": 0,
  "Chocolate en polvo": 0,
  "Harina galleta de leche": 0,

  // Cheesecake específicos
  "Queso crema": 0,
  "Café preparado": 0,
  "Panela": 0,

  // Arroz con leche
  "Arroz": 0,
  "Azúcar": 0,
  "Canela": 0,
  "Sal": 0,
  "Agua": 0
};
