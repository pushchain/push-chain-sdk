# Push Email Application

A modern email application built with React, TypeScript, and Vite, integrated with the Push Protocol. This application provides a seamless email experience with blockchain integration and decentralized features.

## 🚀 Features

- Modern email interface with responsive design
- Integration with Push Protocol for notifications
- Blockchain-based email functionality
- Real-time updates and notifications
- TypeScript for type safety
- Vite for fast development and building
- Tailwind CSS for styling

## 🛠️ Prerequisites

- Node.js (v18 or higher)
- Yarn package manager
- Git

## 📦 Installation

1. First, build the shared components:

   ```bash
   cd packages/shared-components
   yarn install
   yarn build
   ```

2. Then, install and run the email application:

   ```bash
   cd ../../examples/apps/email
   yarn install
   ```

## 🏃‍♂️ Running the Application

### Development Mode

```bash
yarn dev
```

This will start the development server at `http://localhost:5173`

## 🛠️ Tech Stack

- React 18
- TypeScript
- Vite
- Push Protocol for notifications
- Viem for Ethereum interactions
- Tailwind CSS for styling
- Radix UI components
- React Query for data fetching
- React Router for navigation

## 📚 Project Structure

```
email/
├── src/              # Source files
├── public/           # Static assets
├── components.json   # Component configuration
├── vite.config.ts    # Vite configuration
├── tailwind.config.js # Tailwind configuration
└── package.json      # Project dependencies
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.
