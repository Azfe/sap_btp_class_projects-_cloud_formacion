// Horas de inicio y días de cada franja. Lunes = 1 ... sábado = 6, domingo = 0.
export const FRANJAS = {
    diario: { dias: [1, 2, 3, 4, 5], horas: ['20:00'] },
    sabado_manana: { dias: [6], horas: ['10:00', '12:00'] },
    sabado_tarde: { dias: [6], horas: ['16:00', '18:00'] },
    domingo_manana: { dias: [0], horas: ['10:00', '12:00'] },
    domingo_tarde: { dias: [0], horas: ['16:00', '18:00'] },
}

// Días que hay que sumar al lunes para llegar a cada día de la semana
const DESDE_LUNES = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 }

export function barajar(lista) {
    const copia = [...lista]
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
            ;[copia[i], copia[j]] = [copia[j], copia[i]]
    }
    return copia
}

// Algoritmo del círculo: devuelve una lista de rondas; cada ronda es una lista de [local, visitante]
export function emparejamientos(equipos, idaYVuelta) {
    const lista = barajar(equipos)
    if (lista.length % 2) lista.push(null)           // null = descanso
    const n = lista.length
    const rondas = []
    for (let r = 0; r < n - 1; r++) {
        const ronda = []
        for (let i = 0; i < n / 2; i++) {
            const a = lista[i], b = lista[n - 1 - i]
            if (!a || !b) continue                         // el equipo emparejado con null descansa
            ronda.push((r + i) % 2 === 0 ? [a, b] : [b, a]) // alterna quién juega en casa
        }
        rondas.push(ronda)
        lista.splice(1, 0, lista.pop())                  // rota todos menos el primero
    }
    if (idaYVuelta) rondas.push(...rondas.map(ronda => ronda.map(([l, v]) => [v, l])))
    return rondas
}

export function sumarDias(fecha, dias) {
    const d = new Date(fecha)
    d.setDate(d.getDate() + dias)
    return d
}

export function lunesDe(fecha) {
    const d = new Date(`${fecha}T00:00:00`)
    return sumarDias(d, -DESDE_LUNES[d.getDay()])
}

const dosCifras = n => String(n).padStart(2, '0')

export function fechaLocal(valor) {
    const d = new Date(valor)
    return `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`
}

// Formato con el que se guardan los DateTime: 2026-11-14T10:00:00Z
export const isoSegundos = valor => new Date(valor).toISOString().slice(0, 19) + 'Z'

// Huecos (sede + fecha y hora) de una semana, ordenados para repartir los partidos entre los días
export function huecosDeJornada(franja, lunes, sedes, desde) {
    const huecos = []
    for (const hora of franja.horas)
        for (const sede of sedes)
            for (const dia of franja.dias) {
                const d = sumarDias(lunes, DESDE_LUNES[dia])
                const [h, m] = hora.split(':')
                d.setHours(Number(h), Number(m), 0, 0)
                if (d >= desde) huecos.push({ sede, fecha_hora: isoSegundos(d) })
            }
    return huecos
}