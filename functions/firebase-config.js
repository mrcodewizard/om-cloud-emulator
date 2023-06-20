const {initializeApp} = require("firebase/app");
const {getDatabase} = require("firebase/database");

const firebaseConfig = {
  apiKey: "AIzaSyAlRkCMiW6pPvXS0oB0chaZk78q4wdmaM0",
  authDomain: "othermind-be402.firebaseapp.com",
  databaseURL: "https://othermind-be402-default-rtdb.firebaseio.com",
  projectId: "othermind-be402",
  storageBucket: "othermind-be402.appspot.com",
  messagingSenderId: "820142047942",
  appId: "1:820142047942:web:971d15e1be6c787e8a4dc7",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
module.exports = {db};
