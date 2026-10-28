import SwiftUI

struct TodayHeader: View {
    let date: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Today").font(.largeTitle.bold())
            Text(date, style: .date).foregroundStyle(.secondary)
        }
    }
}
