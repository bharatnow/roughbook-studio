@extends('layouts.app')

@section('title', 'Harbor')

@section('content')
    @include('sections.hero', ['title' => 'Plan less, ship more'])
    <x-features />
    @include('sections.pricing')
@endsection
