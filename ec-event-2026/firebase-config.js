const firebaseConfig = {
  apiKey: "AIzaSyBoLTd6gvymrY_GFWeYsMYGVDNmf612-TE",
  authDomain: "ec-event-2026.firebaseapp.com",
  databaseURL: "https://ec-event-2026-default-rtdb.firebaseio.com",
  projectId: "ec-event-2026",
  storageBucket: "ec-event-2026.firebasestorage.app",
  messagingSenderId: "517498133019",
  appId: "1:517498133019:web:25b99c5d839a957a6610be",
  measurementId: "G-VH9P14C081"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();