import SwiftUI

struct TodayView: View {
    @State private var sessions: [Session] = Session.samples
    @State private var adding = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TodayHeader(date: .now)
                ForEach(sessions) { session in
                    SessionRow(session: session)
                }
                StreakCard(days: 12)
            }
            .padding()
        }
        .toolbar {
            Button("New session") { adding = true }
        }
        .sheet(isPresented: $adding) {
            NewSessionSheet()
        }
    }
}

#Preview {
    TodayView()
}
