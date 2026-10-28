import SwiftUI

struct SettingsView: View {
    var body: some View {
        Form {
            AccountSection()
            NotificationsSection()
        }
        .frame(width: 420)
    }
}
