/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          // Add more shades
          600: '#0284c7', // Main primary color
        },
        secondary: {
          // Your secondary colors
        }
      }
    }
  },
  plugins: [],
}
