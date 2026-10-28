import SwiftUI

struct NotificationsSection: View {
    @State private var on = true

    var body: some View {
        Section("Notifications") {
            Toggle("Daily reminder", isOn: $on)
        }
    }
}
