import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

// Firebase
import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../firebase';

export default function Profile() {
  const [stats, setStats] = useState({
    jobs: 0,
    rating: 0,
    earned: 0
  });

  useEffect(() => {
    const fetchStats = async () => {
      const snapshot = await getDocs(collection(db, "requests"));

      let jobs = 0;
      let totalRating = 0;
      let ratingCount = 0;
      let earned = 0;

      snapshot.forEach(doc => {
        const data = doc.data();

        // Jobs completed (accepted + paid)
        if (data.acceptedBy === auth.currentUser?.email && data.paid) {
          jobs++;
          earned += Number(data.price || 0);
        }

        // Ratings received
        if (data.acceptedBy === auth.currentUser?.email && data.rating) {
          totalRating += data.rating;
          ratingCount++;
        }
      });

      const avgRating = ratingCount ? (totalRating / ratingCount).toFixed(1) : 0;

      setStats({
        jobs,
        rating: avgRating,
        earned
      });
    };

    fetchStats();
  }, []);

  return (
    <View style={{ flex: 1, padding: 20 }}>

      <Text style={{ fontSize: 22, marginBottom: 10 }}>
        👤 Profile
      </Text>

      <Text style={{ marginBottom: 20 }}>
        {auth.currentUser?.email}
      </Text>

      <Text>📊 Jobs Completed: {stats.jobs}</Text>
      <Text>⭐ Average Rating: {stats.rating}</Text>
      <Text>💰 Total Earned: ${stats.earned}</Text>

    </View>
  );
}