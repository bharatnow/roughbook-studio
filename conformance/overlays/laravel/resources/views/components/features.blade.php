@props(['items' => ['Boards', 'Reviews', 'Reports']])

<section>
    <ul>
        @foreach ($items as $item)
            <li>{{ $item }}</li>
        @endforeach
    </ul>
</section>
