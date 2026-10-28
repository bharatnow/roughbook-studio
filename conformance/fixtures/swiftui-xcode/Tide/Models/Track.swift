import Foundation
import Observation

struct Track: Identifiable, Hashable {
    let id: Int
    let title: String

    static let samples = [Track(id: 1, title: "Low tide"), Track(id: 2, title: "Undertow")]
}

struct Session: Identifiable {
    let id: Int
    let title: String
    let length: String

    static let samples = [Session(id: 1, title: "Morning", length: "20 min")]
}

@Observable
final class Player {
    var playing: Track?
}
