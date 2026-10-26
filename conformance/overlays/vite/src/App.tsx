import { Faq } from './components/Faq'
import { Hero } from './components/Hero'
import { Pricing } from './components/Pricing'
import { plans } from './data/plans'
import './App.css'

function App() {
  return (
    <main className="page">
      <Hero title="Harbor" lead="Moorings for small boats, booked by the week." />
      <Pricing plans={plans} />
      <Faq />
    </main>
  )
}

export default App
