import SwiftUI

struct NewSessionSheet: View {
    @State private var title = ""

    var body: some View {
        Form {
            TextField("Title", text: $title)
        }
    }
}
